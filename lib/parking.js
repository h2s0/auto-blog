/**
 * 카카오 로컬 API로 행사장 근처 주차장 검색 + 서울 공영주차장 API로 요금 조회
 */

const KAKAO_API = 'https://dapi.kakao.com/v2/local';
const SEOUL_PARK_API = 'http://openapi.seoul.go.kr:8088';

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
    size: 8,
  });
  return data.documents ?? [];
}

function cleanPlaceName(name) {
  return name
    .replace(/\s+\d+층.*/, '')
    .replace(/\s+[BGF]?\d+호.*/, '')
    .trim();
}

// 서울 공영주차장 DB에서 이름으로 요금 조회
async function fetchSeoulParkFee(parkName) {
  const apiKey = process.env.SEOUL_OPEN_DATA_API_KEY;
  if (!apiKey) return null;
  try {
    // "공영주차장", "거주자우선" 등 일반 주차장은 공개 DB에 없을 수 있음
    const searchTerm = parkName.replace(/\(.*\)$/, '').replace(/주차장$/, '').trim();
    const url = `${SEOUL_PARK_API}/${apiKey}/json/GetParkInfo/1/5/${encodeURIComponent(searchTerm)}/`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    if (text.trimStart().startsWith('<')) return null;
    const data = JSON.parse(text);
    const rows = data.GetParkInfo?.row ?? [];
    if (!rows.length) return null;

    // 이름 유사도로 가장 적합한 결과 선택
    const best = rows.find(r => r.PKLT_NM?.includes(searchTerm.substring(0, 3))) ?? rows[0];
    const isFree = best.CHGD_FREE_NM === '무료' || parseFloat(best.PRK_CRG) === 0;
    if (isFree) return '무료';

    const basic = parseFloat(best.PRK_CRG) || 0;
    const basicMin = parseFloat(best.PRK_HM) || 0;
    const add = parseFloat(best.ADD_CRG) || 0;
    const addMin = parseFloat(best.ADD_UNIT_TM_MNT) || 0;
    const dayMax = parseFloat(best.DLY_MAX_CRG) || 0;

    let feeStr = '';
    if (basic > 0 && basicMin > 0) {
      feeStr = `기본 ${basicMin}분 ${basic.toLocaleString()}원`;
      if (add > 0 && addMin > 0) feeStr += `, 추가 ${addMin}분 ${add.toLocaleString()}원`;
      if (dayMax > 0) feeStr += `, 일 최대 ${dayMax.toLocaleString()}원`;
    }
    return feeStr || null;
  } catch {
    return null;
  }
}

export async function findNearbyParking(placeName, count = 3, { lat, lon } = {}) {
  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) {
    console.log('[parking] KAKAO_REST_API_KEY 없음 — 건너뜀');
    return [];
  }

  try {
    let x, y;

    if (lon && lat) {
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
    if (!lots.length) return [];

    // 요금 조회 병렬 실행
    const withFees = await Promise.all(
      lots.slice(0, count + 3).map(async (p) => {
        const fee = await fetchSeoulParkFee(p.place_name);
        return {
          name: p.place_name,
          address: p.address_name,
          distance: `${p.distance}m`,
          mapUrl: p.place_url,
          fee: fee ?? '현장 확인',
        };
      })
    );

    // 공영주차장(요금 정보 있는 것) 우선, 나머지로 채움
    const withFeeInfo = withFees.filter(p => p.fee !== '현장 확인');
    const withoutFeeInfo = withFees.filter(p => p.fee === '현장 확인');
    const result = [...withFeeInfo, ...withoutFeeInfo].slice(0, count);

    console.log(`[parking] 주차장 ${result.length}개 발견 (요금 확인: ${withFeeInfo.length}개)`);
    return result;
  } catch (e) {
    console.log(`[parking] 주차장 검색 실패 (무시하고 진행): ${e.message}`);
    return [];
  }
}
