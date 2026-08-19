/**
 * 카카오 이미지 검색 API로 키워드 관련 사진 URL 반환
 * docs: https://developers.kakao.com/docs/latest/ko/daum-search/dev-guide#search-image
 */

const KAKAO_IMAGE_URL = 'https://dapi.kakao.com/v2/search/image';

/**
 * 키워드로 이미지 검색해 첫 번째 URL 반환. 없으면 null.
 * @param {string} keyword
 * @returns {Promise<string|null>}
 */
export async function searchImage(keyword) {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return null;

  try {
    const url = `${KAKAO_IMAGE_URL}?query=${encodeURIComponent(keyword)}&sort=accuracy&size=5&image_type=photo`;
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${key}` },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const docs = (data.documents ?? []).filter(
      (d) => d.image_url && d.width >= 600 && d.height >= 400
    );
    return docs[0]?.image_url ?? null;
  } catch {
    return null;
  }
}

// 카테고리/슬롯별 검색 키워드 매핑
const CATEGORY_QUERIES = {
  '청약 가이드':   '아파트 청약 신청',
  'LH공고':        '공공임대 아파트',
  '정책뉴스':      '서울 시민 복지 혜택',
  '무료 프로그램': '서울 문화센터 프로그램',
  '전시/미술':     '미술관 전시회',
  '클래식':        '클래식 공연 콘서트',
  '연극':          '연극 공연',
  '뮤지컬':        '뮤지컬 공연',
  '음악':          '음악 공연',
  '축제':          '서울 축제',
  '교육/체험':     '문화 체험 교육',
  '공연':          '서울 공연',
};

/**
 * 카테고리 + 제목으로 관련 이미지 검색
 * @param {string} category
 * @param {string} [title]
 */
export async function getPostImage(category, title) {
  // 제목 키워드로 먼저 시도
  if (title) {
    const img = await searchImage(title.substring(0, 20));
    if (img) return img;
  }
  // 카테고리 기본 키워드로 fallback
  const query = CATEGORY_QUERIES[category] ?? '서울 생활 정보';
  return searchImage(query);
}
