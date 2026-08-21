/**
 * Pexels 무료 스톡 사진 API로 포스트 관련 이미지 URL 반환
 * 라이선스: Pexels License — 상업적 사용 가능, 핫링크 허용
 */

const PEXELS_API = 'https://api.pexels.com/v1/search';

async function searchPexels(query) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;
  try {
    const url = `${PEXELS_API}?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`;
    const res = await fetch(url, { headers: { Authorization: key } });
    if (!res.ok) return null;
    const data = await res.json();
    const photo = data.photos?.[0];
    return photo?.src?.large2x ?? photo?.src?.large ?? null;
  } catch {
    return null;
  }
}

// 정책뉴스 제목에서 Pexels 검색어 추출
function policyTitleToQuery(title) {
  const t = title || '';
  if (/교통|버스|지하철|기후동행|KTX|철도/.test(t)) return 'public transportation subway bus';
  if (/청년|취업|일자리/.test(t)) return 'young people urban career lifestyle';
  if (/출산|육아|아이|어린이|보육/.test(t)) return 'family baby child parenting';
  if (/건강|의료|병원|백신|진료/.test(t)) return 'healthcare hospital medical';
  if (/주거|임대|전세|주택|청약/.test(t)) return 'apartment housing residential building';
  if (/금융|적금|대출|금리|통장/.test(t)) return 'banking finance savings money';
  if (/복지|지원금|혜택|수당|보조/.test(t)) return 'community welfare social support';
  if (/교육|학교|장학/.test(t)) return 'education school learning students';
  if (/환경|탄소|에너지/.test(t)) return 'environment green energy nature';
  return 'seoul korea city government life';
}

// 카테고리별 Pexels 검색어
const CATEGORY_QUERIES = {
  '청약 가이드':     'apartment building korea architecture modern',
  'LH공고':          'public housing apartment complex residential',
  '정책뉴스':        'government policy city community',
  '서울 문화행사':   'seoul korea cultural event performance',
  '전시/미술':       'art gallery museum exhibition',
  '클래식':          'classical music concert orchestra hall',
  '연극':            'theater stage drama performance',
  '뮤지컬':          'musical theater broadway show',
  '음악':            'music concert live performance',
  '축제':            'festival celebration outdoor event',
  '교육/체험':       'education workshop hands-on learning',
  '공연':            'performance stage show arts',
  '무료 프로그램':   'free community program workshop',
};

/**
 * @param {string} category
 * @param {string} [title]
 * @returns {Promise<string|null>} Pexels 이미지 URL 또는 null
 */
export async function getPostImage(category, title) {
  // 정책뉴스는 제목 키워드로 더 적합한 이미지 검색
  if (category === '정책뉴스' && title) {
    const img = await searchPexels(policyTitleToQuery(title));
    if (img) return img;
  }
  const query = CATEGORY_QUERIES[category] ?? 'seoul korea city life';
  return searchPexels(query);
}
