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

async function sendDiscordNotification(publishedPosts) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl || !publishedPosts.length) return;
  try {
    const lines = publishedPosts.map((p, i) => `**${i + 1}.** [${p.title}](${p.url})`).join('\n');
    const kstNow = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `📝 **블로그 자동 발행 완료** (${kstNow})\n${lines}`,
      }),
    });
  } catch (e) {
    console.log(`[discord] 알림 전송 실패 (무시): ${e.message}`);
  }
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
    return { count: 0, posts: [] };
  }
  const featured = selectFeaturedEvents(allEvents, POSTS_PER_DAY);

  let successCount = 0;
  const publishedPosts = [];
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

      const published = await publishPost(post);
      publishedPosts.push({ title: post.title, url: published.url });
      successCount++;
    } catch (err) {
      console.error(`  [오류] 이 행사 건너뜀: ${err.message}`);
    }

    if (i < featured.length - 1) {
      console.log(`  ${DELAY_BETWEEN_POSTS / 1000}초 대기 중...`);
      await sleep(DELAY_BETWEEN_POSTS);
    }
  }
  return { count: successCount, posts: publishedPosts };
}

// ─── 구별 무료공간 파이프라인 (화/목) ────────────────────────────────────────

async function runFacilityPipeline() {
  const allFacilities = await fetchFreeFacilities();
  if (allFacilities.length === 0) {
    console.log('이용 가능한 무료 시설이 없습니다. 종료합니다.');
    return { count: 0, posts: [] };
  }

  const { district, facilities } = selectFeaturedDistrict(allFacilities, 5);

  const parkingMap = {};
  await Promise.all(
    facilities.map(async (f, i) => {
      parkingMap[i] = await findNearbyParking(f.place, 2, { lat: f.lat, lon: f.lon });
    })
  );

  try {
    const post = await generatePostForFacilities(district, facilities, parkingMap);

    const imageUrl = facilities[0]?.imageUrl || null;
    if (imageUrl) {
      post.html = prependImage(post.html, imageUrl, `${district} 무료 문화 프로그램`);
      console.log(`  이미지 첨부: ${imageUrl}`);
    }

    const published = await publishPost(post);
    return { count: 1, posts: [{ title: post.title, url: published.url }] };
  } catch (err) {
    console.error(`  [오류] 무료공간 포스트 실패: ${err.message}`);
    return { count: 0, posts: [] };
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
    const published = await publishPost(post);
    return { count: 1, posts: [{ title: post.title, url: published.url }] };
  } catch (err) {
    console.error(`  [오류] 정책뉴스 포스트 실패: ${err.message}`);
    return { count: 0, posts: [] };
  }
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== 서울 소식 블로그 자동화 시작 ===');
  console.log(`실행 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);

  const dayOfWeek = new Date().getDay(); // 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토
  const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
  console.log(`오늘 요일: ${DAY_NAMES[dayOfWeek]}요일`);

  let result;

  if (dayOfWeek === 2 || dayOfWeek === 4) {
    console.log('모드: 구별 무료 문화 프로그램 모음');
    result = await runFacilityPipeline();
  } else if (dayOfWeek === 6) {
    console.log('모드: 오늘의 정책뉴스');
    result = await runPolicyNewsPipeline();
  } else {
    console.log('모드: 오늘의 서울 문화행사');
    result = await runEventPipeline();
  }

  const { count, posts } = result;
  const totalCount = dayOfWeek === 2 || dayOfWeek === 4 || dayOfWeek === 6 ? 1 : POSTS_PER_DAY;
  console.log(`\n=== 완료: ${count}/${totalCount}개 포스팅 발행 ===`);

  await sendDiscordNotification(posts);
}

main().catch((err) => {
  console.error('[치명적 오류]', err.message);
  process.exit(1);
});
