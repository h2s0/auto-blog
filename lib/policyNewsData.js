/**
 * 정책브리핑 정책뉴스 API
 * Endpoint: https://apis.data.go.kr/1371000/policyNewsService2/policyNewsList2
 */

const API_URL = 'https://apis.data.go.kr/1371000/policyNewsService2/policyNewsList2';

// 시민 혜택·생활 정보 키워드 — 점수 가산
const BENEFIT_KEYWORDS = [
  // 직접 혜택
  '지원', '혜택', '할인', '무료', '감면', '보조', '지급', '환급', '바우처',
  '지원금', '보조금', '수당', '장학금', '적금', '통장', '금리',
  // 교통·이동
  '기후동행카드', '대중교통', '버스', '지하철', '광역버스', 'KTX', '전철', '개통',
  // 주거
  '임대', '공공주택', '청년주택', '전세', '주거급여',
  // 청년·가족
  '청년', '출산', '육아', '어린이', '보육', '양육',
  // 의료·건강
  '건강보험', '의료비', '돌봄', '백신', '진료',
  // 서울시 직접
  '서울', '서울시',
  // 신청·접수
  '신청', '모집', '접수', '확대', '신설',
];

// 생활 관련도 높은 부처
const PRIORITY_MINISTRIES = new Set([
  '보건복지부', '국토교통부', '여성가족부', '교육부', '금융위원회', '기획재정부', '과학기술정보통신부',
]);

// 제외 패턴 — 제목에 포함 시 제외
const EXCLUDE_TITLE_KEYWORDS = [
  // 사건·수사·처벌
  '수사', '기소', '처벌', '단속', '감독 착수', '감독에 착수', '범죄', '중수청',
  '사망', '사고', '재해', '산재', '끼임', '추락',
  // 팩트체크·설명자료
  '[사실은 이렇습니다]', '[설명]', '[보도설명]', '[보도참고]',
  // 외교·군사·정치
  '외교', '국방', '북한', '미사일', '국회', '탄핵',
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
  const titleAndSub = item.title + ' ' + item.subtitle;

  // 제외 키워드 포함 시 바로 탈락
  if (EXCLUDE_TITLE_KEYWORDS.some((kw) => titleAndSub.includes(kw))) return -999;

  let score = 0;
  if (PRIORITY_MINISTRIES.has(item.ministry)) score += 10;

  const haystack = (titleAndSub + ' ' + item.summary).toLowerCase();
  for (const kw of BENEFIT_KEYWORDS) {
    if (haystack.includes(kw)) score += 4;
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
