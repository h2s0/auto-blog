/**
 * 정책브리핑 정책뉴스 API (문화체육관광부)
 * data.go.kr: 문화체육관광부_정책브리핑_정책뉴스_API
 * Endpoint: https://apis.data.go.kr/1371000/policyNewsService2/policyNewsList2
 * 필수 파라미터: serviceKey, startDate(YYYYMMDD), endDate(YYYYMMDD)
 */

const API_URL = 'https://apis.data.go.kr/1371000/policyNewsService2/policyNewsList2';

// 문화·서울 생활 관련 키워드 (제목 필터용)
const CULTURE_KEYWORDS = [
  '문화', '예술', '공연', '전시', '관광', '박물관', '미술관', '도서관',
  '영화', '축제', '체육', '스포츠', '여행', '나들이', '공원', '유산',
  '서울', '수도권', '경기', '교육', '청소년', '어린이', '가족',
];

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
    items.push({
      id:       extractTag(block, 'NewsItemId'),
      title:    extractCdata(block, 'Title'),
      subtitle: extractCdata(block, 'SubTitle1'),
      ministry: extractTag(block, 'MinisterCode'),
      url:      extractCdata(block, 'OriginalUrl'),
      date:     extractTag(block, 'ApproveDate').substring(0, 10),
      summary:  stripHtml(rawContent).substring(0, 400),
    });
  }
  return items;
}

async function fetchPolicyNews(apiKey, dateParam) {
  const url = `${API_URL}?serviceKey=${apiKey}&numOfRows=100&pageNo=1&startDate=${dateParam}&endDate=${dateParam}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`정책브리핑 API HTTP error: ${res.status}`);
  const text = await res.text();
  return parseItems(text);
}

function scoreItem(item) {
  let score = 0;
  if (item.ministry === '문화체육관광부') score += 10;
  const haystack = (item.title + ' ' + item.subtitle).toLowerCase();
  for (const kw of CULTURE_KEYWORDS) {
    if (haystack.includes(kw)) score += 2;
  }
  return score;
}

export async function fetchTodayPolicyNews() {
  const apiKey = process.env.POLICY_NEWS_API_KEY;
  if (!apiKey) throw new Error('POLICY_NEWS_API_KEY 환경변수가 없습니다.');

  const today = new Date();
  const dateParam = toDateParam(today);
  console.log(`[policyNews] ${dateParam} 정책뉴스 수집 중...`);

  const items = await fetchPolicyNews(apiKey, dateParam);
  console.log(`[policyNews] 전체 ${items.length}건 수집`);

  // 관련도 순 정렬, 상위 5개 반환
  const scored = items
    .map((item) => ({ ...item, score: scoreItem(item) }))
    .sort((a, b) => b.score - a.score);

  const selected = scored.slice(0, 5);
  console.log(`[policyNews] 선정 ${selected.length}건:`);
  selected.forEach((n, i) => console.log(`  ${i + 1}. [${n.ministry}] ${n.title}`));
  return selected;
}
