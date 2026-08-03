import 'dotenv/config';
import { fetchTodayEvents, selectFeaturedEvents } from './lib/seoulData.js';
import { fetchFreeFacilities, selectFeaturedDistrict } from './lib/seoulFacilityData.js';
import { fetchTodayPolicyNews } from './lib/policyNewsData.js';
import { scrapeEventPage } from './lib/scraper.js';
import { findNearbyParking } from './lib/parking.js';
import { generatePostForEvent, generatePostForFacilities, generatePostForPolicyNews } from './lib/generateContent.js';
import { publishPost } from './lib/blogger.js';

const POSTS_PER_DAY = 3;
const DELAY_BETWEEN_POSTS = 8000;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickImage(event, ogImage) {
  return event.imageUrl || ogImage || null;
}

function prependImage(html, imageUrl, altText) {
  if (!imageUrl) return html;
  const img = `<p><img src="${imageUrl}" alt="${altText}" style="max-width:100%;height:auto;border-radius:8px;" /></p>\n`;
  return img + html;
}

// ─── 문화행사 파이프라인 (월/수/금/일 + 기본값) ──────────────────────────────

async function runEventPipeline() {
  const allEvents = await fetchTodayEvents();
  if (allEvents.length === 0) {
    console.log('오늘 진행 중인 행사가 없습니다. 종료합니다.');
    return 0;
  }
  const featured = selectFeaturedEvents(allEvents, POSTS_PER_DAY);

  let successCount = 0;
  for (let i = 0; i < featured.length; i++) {
    const event = featured[i];
    console.log(`\n[${i + 1}/${featured.length}] ${event.title}`);

    try {
      const [{ text: scrapedText, ogImage }, parkingLots] = await Promise.all([
        scrapeEventPage(event.orgLink),
        findNearbyParking(event.place, 3, { lat: event.lat, lon: event.lon }),
      ]);

      const post = await generatePostForEvent(event, scrapedText, parkingLots);

      const imageUrl = pickImage(event, ogImage);
      if (imageUrl) {
        post.html = prependImage(post.html, imageUrl, event.title);
        console.log(`  이미지 첨부: ${imageUrl}`);
      } else {
        console.log('  이미지 없음');
      }

      await publishPost(post);
      successCount++;
    } catch (err) {
      console.error(`  [오류] 이 행사 건너뜀: ${err.message}`);
    }

    if (i < featured.length - 1) {
      console.log(`  ${DELAY_BETWEEN_POSTS / 1000}초 대기 중...`);
      await sleep(DELAY_BETWEEN_POSTS);
    }
  }
  return successCount;
}

// ─── 구별 무료공간 파이프라인 (화/목) ────────────────────────────────────────

async function runFacilityPipeline() {
  const allFacilities = await fetchFreeFacilities();
  if (allFacilities.length === 0) {
    console.log('이용 가능한 무료 시설이 없습니다. 종료합니다.');
    return 0;
  }

  const { district, facilities } = selectFeaturedDistrict(allFacilities, 5);

  // 각 시설의 주차장 정보 수집 (인덱스 → 주차장 목록 매핑)
  const parkingMap = {};
  await Promise.all(
    facilities.map(async (f, i) => {
      parkingMap[i] = await findNearbyParking(f.place, 2, { lat: f.lat, lon: f.lon });
    })
  );

  try {
    const post = await generatePostForFacilities(district, facilities, parkingMap);

    // 대표 이미지: 첫 시설 이미지 사용
    const imageUrl = facilities[0]?.imageUrl || null;
    if (imageUrl) {
      post.html = prependImage(post.html, imageUrl, `${district} 무료 문화 프로그램`);
      console.log(`  이미지 첨부: ${imageUrl}`);
    }

    await publishPost(post);
    return 1;
  } catch (err) {
    console.error(`  [오류] 무료공간 포스트 실패: ${err.message}`);
    return 0;
  }
}

// ─── 정책뉴스 파이프라인 (토요일) ─────────────────────────────────────────────

async function runPolicyNewsPipeline() {
  let newsItems;
  try {
    newsItems = await fetchTodayPolicyNews();
  } catch (err) {
    console.log(`[policyNews] 수집 실패 (문화행사로 대체): ${err.message}`);
    return runEventPipeline();
  }

  if (newsItems.length < 2) {
    console.log('[policyNews] 관련 뉴스 부족 — 문화행사 파이프라인으로 대체');
    return runEventPipeline();
  }

  try {
    const post = await generatePostForPolicyNews(newsItems);
    await publishPost(post);
    return 1;
  } catch (err) {
    console.error(`  [오류] 정책뉴스 포스트 실패: ${err.message}`);
    return 0;
  }
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== 서울 소식 블로그 자동화 시작 ===');
  console.log(`실행 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);

  const dayOfWeek = new Date().getDay(); // 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토
  const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
  console.log(`오늘 요일: ${DAY_NAMES[dayOfWeek]}요일`);

  let successCount = 0;
  let totalCount = 0;

  if (dayOfWeek === 2 || dayOfWeek === 4) {
    // 화요일, 목요일 → 구별 무료공간 모음 포스트
    console.log('모드: 구별 무료 문화 프로그램 모음');
    totalCount = 1;
    successCount = await runFacilityPipeline();
  } else if (dayOfWeek === 6) {
    // 토요일 → 정책뉴스 모음 포스트
    console.log('모드: 오늘의 정책뉴스');
    totalCount = 1;
    successCount = await runPolicyNewsPipeline();
  } else {
    // 월/수/금/일 → 문화행사 포스트 3개
    console.log('모드: 오늘의 서울 문화행사');
    successCount = await runEventPipeline();
    totalCount = POSTS_PER_DAY;
  }

  console.log(`\n=== 완료: ${successCount}/${totalCount}개 포스팅 발행 ===`);
}

main().catch((err) => {
  console.error('[치명적 오류]', err.message);
  process.exit(1);
});
