/**
 * 정책브리핑 정책뉴스 API
 * Endpoint: https://apis.data.go.kr/1371000/policyNewsService2/policyNewsList2
 */

const API_URL = 'https://apis.data.go.kr/1371000/policyNewsService2/policyNewsList2';

// 서울 시민 생활 밀착 키워드 (복지·주거·취업·의료·교통 중심)
const LIFE_KEYWORDS = [
  // 복지·지원
  '복지', '지원', '혜택', '보조금', '지원금', '수당', '장학금', '바우처',
  // 주거·부동산
  '임대', '주택', '전세', '주거', '아파트', '분양', '공공주택',
  // 취업·일자리
  '취업', '일자리', '고용', '창업', '채용', '구직', '근로',
  // 의료·건강
  '의료', '건강', '병원', '건강보험', '의약품', '백신', '돌봄',
  // 교통
  '교통', '대중교통', '버스', '지하철', '택시', '주차',
  // 생활비·세금
  '물가', '전기요금', '가스요금', '세금', '세액공제', '환급',
  // 교육·보육
  '교육', '어린이집', '유치원', '학교', '청소년', '어린이', '보육',
  // 서울·수도권
  '서울', '수도권',
  // 가족
  '가족', '출산', '육아', '노인', '노령', '장애',
];

// 생활 관련도 높은 부처 (우선 정렬)
const PRIORITY_MINISTRIES = new Set([
  '보건복지부', '국토교통부', '고용노동부', '여성가족부', '교육부',
  '행정안전부', '환경부', '금융위원회', '기획재정부',
]);

// "[사실은 이렇습니다]" 팩트체크 자료 등 제외
const EXCLUDE_PREFIXES = ['[사실은 이렇습니다]', '[설명]', '[보도설명]', '[보도참고]'];

function toDateParam(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function extractTag(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`));
  return m ? m[1].trim() : '';
}

function extractCdata(text, tag) {
  const m = text.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`));
  return m ? m[1].trim() : '';
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseItems(xmlText) {
  const items = [];
  const re = /<NewsItem>([\s\S]*?)<\/NewsItem>/g;
  let m;
  while ((m = re.exec(xmlText)) !== null) {
    const block = m[1];
    const rawContent = extractCdata(block, 'DataContents');
    const title = extractCdata(block, 'Title');
    if (!title) continue;

    items.push({
      id:       extractTag(block, 'NewsItemId'),
      title,
      subtitle: extractCdata(block, 'SubTitle1'),
      ministry: extractTag(block, 'MinisterCode'),
      url:      extractCdata(block, 'OriginalUrl'),
      date:     extractTag(block, 'ApproveDate').substring(0, 10),
      summary:  stripHtml(rawContent).substring(0, 500),
    });
  }
  return items;
}

async function fetchPolicyNews(apiKey, startDate, endDate) {
  const url = `${API_URL}?serviceKey=${apiKey}&numOfRows=100&pageNo=1&startDate=${startDate}&endDate=${endDate}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`정책브리핑 API HTTP error: ${res.status}`);
  return parseItems(await res.text());
}

function scoreItem(item) {
  // 팩트체크·설명자료 제외
  if (EXCLUDE_PREFIXES.some((p) => item.title.startsWith(p))) return -999;

  let score = 0;
  if (PRIORITY_MINISTRIES.has(item.ministry)) score += 15;

  const haystack = (item.title + ' ' + item.subtitle + ' ' + item.summary).toLowerCase();
  for (const kw of LIFE_KEYWORDS) {
    if (haystack.includes(kw)) score += 3;
  }
  return score;
}

export async function fetchTodayPolicyNews() {
  const apiKey = process.env.POLICY_NEWS_API_KEY;
  if (!apiKey) throw new Error('POLICY_NEWS_API_KEY 환경변수가 없습니다.');

  // 오늘 포함 최근 3일 범위로 수집 (주말·공휴일 대응)
  const today = new Date();
  const threeDaysAgo = new Date(today);
  threeDaysAgo.setDate(today.getDate() - 2);

  const endParam   = toDateParam(today);
  const startParam = toDateParam(threeDaysAgo);
  console.log(`[policyNews] ${startParam}~${endParam} 정책뉴스 수집 중...`);

  const items = await fetchPolicyNews(apiKey, startParam, endParam);
  console.log(`[policyNews] 전체 ${items.length}건 수집`);

  const scored = items
    .map((item) => ({ ...item, score: scoreItem(item) }))
    .filter((item) => item.score > 0) // 관련 없는 기사 제거
    .sort((a, b) => b.score - a.score);

  // 상위 4건 (분량 조절)
  const selected = scored.slice(0, 4);
  console.log(`[policyNews] 선정 ${selected.length}건:`);
  selected.forEach((n, i) => console.log(`  ${i + 1}. [${n.ministry}] ${n.title} (score:${n.score})`));
  return selected;
}
