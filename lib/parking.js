/**
 * 카카오 로컬 API로 행사장 근처 주차장 검색
 * 무료: 하루 300,000 요청
 */

const KAKAO_API = 'https://dapi.kakao.com/v2/local';

async function kakaoFetch(path, params) {
  const url = `${KAKAO_API}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Kakao API error ${res.status}`);
  return res.json();
}

// 장소명으로 좌표 검색
async function geocodePlace(placeName) {
  const data = await kakaoFetch('/search/keyword.json', {
    query: placeName,
    size: 1,
  });
  const doc = data.documents?.[0];
  if (!doc) return null;
  return { x: doc.x, y: doc.y, address: doc.address_name };
}

// 좌표 기준 반경 내 주차장 검색 (카테고리 PK6)
async function searchNearbyParking(x, y, radius = 1000) {
  const data = await kakaoFetch('/search/category.json', {
    category_group_code: 'PK6',
    x, y,
    radius,
    sort: 'distance',
    size: 5,
  });
  return data.documents ?? [];
}

// "구립증산도서관 1층 문화교육실" → "구립증산도서관" 처럼 층/호실 제거
function cleanPlaceName(name) {
  return name
    .replace(/\s+\d+층.*/, '')       // " 1층 문화교육실" 제거
    .replace(/\s+[BGF]?\d+호.*/, '') // " B101호" 제거
    .trim();
}

export async function findNearbyParking(placeName, count = 3) {
  placeName = cleanPlaceName(placeName);
  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) {
    console.log('[parking] KAKAO_REST_API_KEY 없음 — 주차장 검색 건너뜀');
    return [];
  }

  try {
    console.log(`[parking] "${placeName}" 근처 주차장 검색 중...`);
    const coords = await geocodePlace(placeName);
    if (!coords) {
      console.log('[parking] 장소 좌표를 찾을 수 없음');
      return [];
    }

    const lots = await searchNearbyParking(coords.x, coords.y);
    const result = lots.slice(0, count).map((p) => ({
      name: p.place_name,
      address: p.address_name,
      distance: `${p.distance}m`,
      mapUrl: p.place_url,
    }));

    console.log(`[parking] 주차장 ${result.length}개 발견`);
    return result;
  } catch (e) {
    console.log(`[parking] 주차장 검색 실패 (무시하고 진행): ${e.message}`);
    return [];
  }
}
