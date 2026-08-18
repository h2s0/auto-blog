/**
 * LH 청약 공고 API
 * 공공데이터포털: https://www.data.go.kr/data/15052836/openapi.do
 */

const LH_API_BASE = 'http://apis.data.go.kr/B552555/lhNoticeInfo1/getNoticeInfo1';

async function fetchNoticesByType(serviceKey, houseSecd) {
  const params = new URLSearchParams({
    serviceKey,
    PG_SZ: '10',
    PAGE_NO: '1',
    HOUSE_SECD: houseSecd,
  });

  const res = await fetch(`${LH_API_BASE}?${params}`);
  if (!res.ok) throw new Error(`LH API HTTP error: ${res.status}`);

  const text = await res.text();
  if (text.trimStart().startsWith('<')) {
    const msgMatch = text.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>/);
    const msg = msgMatch?.[1] ?? text.substring(0, 200);
    throw new Error(`LH API 오류: ${msg}`);
  }

  const json = JSON.parse(text);
  const items = json.dsList ?? json.data ?? [];
  return Array.isArray(items) ? items : [];
}

function parseNotice(item) {
  return {
    title:     item.SBD_LGO_NM   ?? item.공고명        ?? '',
    type:      item.SPL_TY_CD_NM  ?? item.공급유형       ?? '',
    startDate: item.RCPT_BGNG_DE  ?? item.접수시작일      ?? '',
    endDate:   item.RCPT_END_DE   ?? item.접수종료일      ?? '',
    area:      item.SUPLY_AREA_NM ?? item.공급지역       ?? '',
    org:       item.UPP_AHR_NM    ?? item.기관명        ?? 'LH',
    detailUrl: item.DTL_URL       ?? item.상세URL       ?? '',
    noticeNo:  item.PBLANC_NO     ?? item.공고번호       ?? '',
  };
}

export async function fetchLhNotices() {
  const serviceKey = process.env.POLICY_NEWS_API_KEY;
  if (!serviceKey) throw new Error('POLICY_NEWS_API_KEY 환경변수가 없습니다.');

  console.log('[lhData] LH/SH 청약 공고 수집 시작');

  // 공공임대(01)와 공공분양(02) 병렬 조회
  const results = await Promise.allSettled([
    fetchNoticesByType(serviceKey, '01'),
    fetchNoticesByType(serviceKey, '02'),
  ]);

  const allItems = [];
  for (const r of results) {
    if (r.status === 'fulfilled') allItems.push(...r.value);
    else console.log(`[lhData] 일부 조회 실패 (무시): ${r.reason?.message}`);
  }

  if (allItems.length === 0) {
    console.log('[lhData] 공고 없음 또는 API 키 미승인');
    return [];
  }

  const notices = allItems.map(parseNotice).filter((n) => n.title);
  console.log(`[lhData] 수집된 공고: ${notices.length}건`);
  return notices.slice(0, 6);
}
