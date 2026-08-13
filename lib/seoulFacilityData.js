/**
 * 서울시 공공서비스 예약 정보 (문화체험 프로그램)
 * API: ListPublicReservationCulture
 */

import { getKstDateString, getKstDayOfWeek } from './kstDate.js';

const API_BASE = 'http://openapi.seoul.go.kr:8088';
const PAGE_SIZE = 1000;

async function fetchPage(apiKey, start, end) {
  const url = `${API_BASE}/${apiKey}/json/ListPublicReservationCulture/${start}/${end}/`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Seoul Facility API HTTP error: ${res.status}`);

  const text = await res.text();
  if (text.trimStart().startsWith('<')) {
    throw new Error(`Seoul Facility API XML 에러: ${text.substring(0, 200)}`);
  }

  const json = JSON.parse(text);
  const root = json.ListPublicReservationCulture;
  if (!root) throw new Error(`Seoul Facility API error: ${json.RESULT?.MESSAGE ?? JSON.stringify(json)}`);
  if (root.RESULT?.CODE && root.RESULT.CODE !== 'INFO-000') {
    throw new Error(`Seoul Facility API error: ${root.RESULT.MESSAGE}`);
  }
  return { total: root.list_total_count, rows: root.row ?? [] };
}

function parseRow(row) {
  return {
    name:           row.SVCNM?.trim() ?? '',
    category:       row.MINCLASSNM?.trim() ?? '',
    place:          row.PLACENM?.trim() ?? '',
    district:       row.AREANM?.trim() ?? '',
    targetAudience: row.USETGTINFO?.trim() ?? '',
    isFree:         row.PAYATNM?.trim() === '무료',
    payType:        row.PAYATNM?.trim() ?? '',
    bookingUrl:     row.SVCURL?.trim() ?? '',
    imageUrl:       row.IMGURL?.trim() ?? '',
    description:    row.DTLCONT?.trim().substring(0, 500) ?? '',
    phone:          row.TELNO?.trim() ?? '',
    startDate:      row.SVCOPNBGNDT?.substring(0, 10) ?? '',
    endDate:        row.SVCOPNENDDT?.substring(0, 10) ?? '',
    operatingTime:  (row.V_MIN && row.V_MAX) ? `${row.V_MIN} ~ ${row.V_MAX}` : '',
    lon:            parseFloat(row.X) || null,
    lat:            parseFloat(row.Y) || null,
    status:         row.SVCSTATNM?.trim() ?? '',
  };
}

export async function fetchFreeFacilities() {
  const apiKey = process.env.SEOUL_OPEN_DATA_API_KEY;
  if (!apiKey) throw new Error('SEOUL_OPEN_DATA_API_KEY 환경변수가 없습니다.');

  const today = getKstDateString();
  console.log(`[facilityData] ${today} 기준 무료 문화 프로그램 수집 시작`);

  const first = await fetchPage(apiKey, 1, PAGE_SIZE);
  const total = first.total;
  let allRows = [...first.rows];

  const pageCount = Math.ceil(total / PAGE_SIZE);
  if (pageCount > 1) {
    const extra = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, i) =>
        fetchPage(apiKey, (i + 1) * PAGE_SIZE + 1, (i + 2) * PAGE_SIZE)
      )
    );
    extra.forEach((r) => allRows.push(...r.rows));
  }

  // 무료 + 현재 예약 가능 또는 접수 중인 것만
  const facilities = allRows
    .map(parseRow)
    .filter((f) => f.isFree && f.name && f.endDate >= today);

  console.log(`[facilityData] 무료 프로그램: ${facilities.length}건`);
  return facilities;
}

// 자치구별로 그룹핑하여 오늘 선정 구와 대표 시설 목록 반환
export function selectFeaturedDistrict(facilities, facilityCount = 5) {
  // 구별 카운트
  const byDistrict = {};
  for (const f of facilities) {
    const d = f.district || '기타';
    if (!byDistrict[d]) byDistrict[d] = [];
    byDistrict[d].push(f);
  }

  // 가장 프로그램이 많은 구 선택 (매일 다르게 → 요일 기반 로테이션)
  const dayOfWeek = getKstDayOfWeek(); // 0=일 ~ 6=토
  const districts = Object.keys(byDistrict).sort(
    (a, b) => byDistrict[b].length - byDistrict[a].length
  );

  // 상위 5개 구 중 요일로 순환 선택
  const pickedDistrict = districts[dayOfWeek % Math.min(districts.length, 5)] ?? districts[0];

  const pool = byDistrict[pickedDistrict];
  const withUrl = pool.filter((f) => f.bookingUrl);
  const withoutUrl = pool.filter((f) => !f.bookingUrl);

  // 예약 링크 있는 것 우선, 부족하면 없는 것으로 채움
  const selected = [
    ...withUrl,
    ...withoutUrl,
  ].slice(0, facilityCount);

  // 5개 미만이면 다른 구에서 보충
  if (selected.length < facilityCount) {
    const otherDistricts = districts.filter((d) => d !== pickedDistrict);
    for (const d of otherDistricts) {
      if (selected.length >= facilityCount) break;
      const extra = byDistrict[d].filter((f) => !selected.includes(f));
      selected.push(...extra.slice(0, facilityCount - selected.length));
    }
  }

  console.log(`[facilityData] 오늘의 구: ${pickedDistrict} (${selected.length}개 선택)`);
  return { district: pickedDistrict, facilities: selected };
}
