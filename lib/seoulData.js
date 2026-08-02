/**
 * 서울 열린데이터광장 문화행사정보 API
 * API 문서: https://data.seoul.go.kr/dataList/OA-15486/S/1/datasetView.do
 *
 * URL 형식: /{KEY}/json/culturalEventInfo/{start}/{end}/{CODENAME}/{TITLE}/{DATE}/
 * DATE 파라미터로 STRTDATE 필터링 가능 — 단, 진행 중인 행사(END_DATE >= 오늘)는
 * 클라이언트에서 추가 필터링 필요.
 */

const API_BASE = 'http://openapi.seoul.go.kr:8088';
const PAGE_SIZE = 1000;
const CONCURRENCY = 5; // 동시 요청 수 제한

function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function fetchPage(apiKey, start, end, dateFilter) {
  // DATE 파라미터: STRTDATE가 이 날짜 이하인 행사만 반환 (서버 측 1차 필터)
  const url = `${API_BASE}/${apiKey}/json/culturalEventInfo/${start}/${end}////${dateFilter}/`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Seoul API HTTP error: ${res.status}`);

  const text = await res.text();
  if (text.trimStart().startsWith('<')) {
    throw new Error(`Seoul API가 XML 에러를 반환했습니다 (요청 한도 초과 또는 잘못된 키): ${text.substring(0, 200)}`);
  }

  const json = JSON.parse(text);
  const root = json.culturalEventInfo;
  if (!root) {
    const errMsg = json.RESULT?.MESSAGE ?? JSON.stringify(json);
    throw new Error(`Seoul API error: ${errMsg}`);
  }
  if (root.RESULT?.CODE && root.RESULT.CODE !== 'INFO-000') {
    throw new Error(`Seoul API error: ${root.RESULT.MESSAGE}`);
  }
  return { total: root.list_total_count, rows: root.row ?? [] };
}

// 동시 요청 수를 제한하는 병렬 실행
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
    title: row.TITLE?.trim() ?? '',
    category: row.CODENAME?.trim() ?? '',
    place: row.PLACE?.trim() ?? '',
    startDate: row.STRTDATE?.substring(0, 10) ?? '',
    endDate: row.END_DATE?.substring(0, 10) ?? '',
    description: row.PROGRAM?.trim() ?? '',
    targetAudience: row.USE_TRGT?.trim() ?? '',
    isFree: row.IS_FREE?.trim() === '무료',
    imageUrl: row.MAIN_IMG?.trim() ?? '',
    orgLink: row.ORG_LINK?.trim() ?? '',
  };
}

export async function fetchTodayEvents() {
  const apiKey = process.env.SEOUL_OPEN_DATA_API_KEY;
  if (!apiKey) throw new Error('SEOUL_OPEN_DATA_API_KEY 환경변수가 없습니다.');

  const today = toDateString(new Date());
  console.log(`[seoulData] 오늘 날짜: ${today} 기준 행사 수집 시작`);

  // 첫 페이지: 전체 건수 파악 + DATE 파라미터로 오늘 이전 시작 행사만 필터링
  const first = await fetchPage(apiKey, 1, PAGE_SIZE, today);
  const total = first.total;
  console.log(`[seoulData] 오늘 이전 시작 행사 수: ${total}건`);

  let allRows = [...first.rows];

  // 나머지 페이지를 concurrency 제한으로 병렬 수집
  const pageCount = Math.ceil(total / PAGE_SIZE);
  if (pageCount > 1) {
    const tasks = Array.from({ length: pageCount - 1 }, (_, i) => {
      const p = i + 1;
      return () => fetchPage(apiKey, p * PAGE_SIZE + 1, (p + 1) * PAGE_SIZE, today);
    });
    const results = await pLimit(tasks, CONCURRENCY);
    results.forEach((r) => allRows.push(...r.rows));
  }

  // startDate <= 오늘 <= endDate 인 행사만 필터링 (진행 중)
  const events = allRows
    .map(parseRow)
    .filter((e) => e.startDate <= today && today <= e.endDate);

  console.log(`[seoulData] 오늘 진행 중인 행사: ${events.length}건`);
  return events;
}
