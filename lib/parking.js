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

async function geocodePlace(placeName) {
  const data = await kakaoFetch('/search/keyword.json', { query: placeName, size: 1 });
  const doc = data.documents?.[0];
  if (!doc) return null;
  return { x: doc.x, y: doc.y };
}

async function searchNearbyParking(x, y, radius = 1000) {
  const data = await kakaoFetch('/search/category.json', {
    category_group_code: 'PK6',
    x, y, radius,
    sort: 'distance',
    size: 5,
  });
  return data.documents ?? [];
}

function cleanPlaceName(name) {
  return name
    .replace(/\s+\d+층.*/, '')
    .replace(/\s+[BGF]?\d+호.*/, '')
    .trim();
}

// lat/lon: culturalEventInfo API에서 직접 가져온 좌표 (있으면 지오코딩 생략)
export async function findNearbyParking(placeName, count = 3, { lat, lon } = {}) {
  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) {
    console.log('[parking] KAKAO_REST_API_KEY 없음 — 건너뜀');
    return [];
  }

  try {
    let x, y;

    if (lon && lat) {
      // 서울 API가 제공한 좌표 직접 사용 (지오코딩 불필요)
      x = String(lon);
      y = String(lat);
      console.log(`[parking] 좌표 직접 사용 (${lat}, ${lon}) — 주차장 검색 중...`);
    } else {
      const cleaned = cleanPlaceName(placeName);
      console.log(`[parking] "${cleaned}" 지오코딩 후 주차장 검색 중...`);
      const coords = await geocodePlace(cleaned);
      if (!coords) {
        console.log('[parking] 장소 좌표를 찾을 수 없음');
        return [];
      }
      x = coords.x;
      y = coords.y;
    }

    const lots = await searchNearbyParking(x, y);
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
