/**
 * 서울 열린데이터광장 문화행사정보 API
 * API 문서: https://data.seoul.go.kr/dataList/OA-15486/S/1/datasetView.do
 */

const API_BASE = 'http://openapi.seoul.go.kr:8088';
const PAGE_SIZE = 1000;
const CONCURRENCY = 5;

function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function fetchPage(apiKey, start, end, dateFilter) {
  const url = `${API_BASE}/${apiKey}/json/culturalEventInfo/${start}/${end}////${dateFilter}/`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Seoul API HTTP error: ${res.status}`);

  const text = await res.text();
  if (text.trimStart().startsWith('<')) {
    throw new Error(`Seoul API XML 에러 (한도 초과 또는 잘못된 키): ${text.substring(0, 200)}`);
  }

  const json = JSON.parse(text);
  const root = json.culturalEventInfo;
  if (!root) throw new Error(`Seoul API error: ${json.RESULT?.MESSAGE ?? JSON.stringify(json)}`);
  if (root.RESULT?.CODE && root.RESULT.CODE !== 'INFO-000') {
    throw new Error(`Seoul API error: ${root.RESULT.MESSAGE}`);
  }
  return { total: root.list_total_count, rows: root.row ?? [] };
}

async function pLimit(tasks, concurrency) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

function parseRow(row) {
  return {
    title:          row.TITLE?.trim() ?? '',
    category:       row.CODENAME?.trim() ?? '',
    district:       row.GUNAME?.trim() ?? '',        // 자치구 (강동구 등)
    place:          row.PLACE?.trim() ?? '',
    startDate:      row.STRTDATE?.substring(0, 10) ?? '',
    endDate:        row.END_DATE?.substring(0, 10) ?? '',
    performTime:    row.PRO_TIME?.trim() ?? '',      // 공연 시작 시간
    description:    row.PROGRAM?.trim() ?? '',
    etcDesc:        row.ETC_DESC?.trim() ?? '',      // 기타 안내
    useFee:         row.USE_FEE?.trim() ?? '',       // 입장료 상세
    targetAudience: row.USE_TRGT?.trim() ?? '',
    performers:     row.PLAYER?.trim() ?? '',        // 출연자
    inquiry:        row.INQUIRY?.trim() ?? '',       // 문의 전화
    isFree:         row.IS_FREE?.trim() === '무료',
    imageUrl:       row.MAIN_IMG?.trim() ?? '',
    orgLink:        row.ORG_LINK?.trim() ?? '',
    homepageUrl:    row.HMPG_ADDR?.trim() ?? '',    // 공식 홈페이지
    lat:            parseFloat(row.LAT) || null,    // 위도
    lon:            parseFloat(row.LOT) || null,    // 경도
  };
}

export async function fetchTodayEvents() {
  const apiKey = process.env.SEOUL_OPEN_DATA_API_KEY;
  if (!apiKey) throw new Error('SEOUL_OPEN_DATA_API_KEY 환경변수가 없습니다.');

  const today = toDateString(new Date());
  console.log(`[seoulData] ${today} 기준 행사 수집 시작`);

  const first = await fetchPage(apiKey, 1, PAGE_SIZE, today);
  const total = first.total;
  console.log(`[seoulData] 전체 행사 수: ${total}건`);

  let allRows = [...first.rows];

  const pageCount = Math.ceil(total / PAGE_SIZE);
  if (pageCount > 1) {
    const tasks = Array.from({ length: pageCount - 1 }, (_, i) => {
      const p = i + 1;
      return () => fetchPage(apiKey, p * PAGE_SIZE + 1, (p + 1) * PAGE_SIZE, today);
    });
    const results = await pLimit(tasks, CONCURRENCY);
    results.forEach((r) => allRows.push(...r.rows));
  }

  const events = allRows
    .map(parseRow)
    .filter((e) => e.startDate <= today && today <= e.endDate);

  console.log(`[seoulData] 오늘 진행 중인 행사: ${events.length}건`);
  return events;
}

export function selectFeaturedEvents(events, count = 1, offset = 0) {
  const today = toDateString(new Date());

  function score(e) {
    let s = 0;
    if (e.startDate === today) s += 4;
    if (e.orgLink) s += 3;
    if (e.description) s += 2;
    if (e.useFee || e.isFree) s += 1;
    if (e.imageUrl) s += 1;
    if (e.lat && e.lon) s += 1;      // 좌표 있으면 주차 검색 정확도 UP
    if (e.performers) s += 1;
    return s;
  }

  const byCategory = {};
  for (const e of events) {
    const cat = e.category || '기타';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(e);
  }

  // 카테고리별 1등씩 뽑아 전체 점수순 정렬 후 offset 위치부터 선택
  const candidates = Object.values(byCategory)
    .map((group) => group.sort((a, b) => score(b) - score(a))[0])
    .sort((a, b) => score(b) - score(a));

  const selected = candidates.slice(offset, offset + count);
  console.log(`[seoulData] 포스팅 대상 ${selected.length}개 선택:`);
  selected.forEach((e, i) =>
    console.log(`  ${i + 1}. [${e.category}] ${e.title} (${e.district || '구 미상'})`)
  );
  return selected;
}
