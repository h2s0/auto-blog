import 'dotenv/config';
import { fetchTodayEvents, selectFeaturedEvents } from './lib/seoulData.js';
import { fetchFreeFacilities, selectFeaturedDistrict } from './lib/seoulFacilityData.js';
import { fetchTodayPolicyNews } from './lib/policyNewsData.js';
import { fetchExhibitionNews } from './lib/exhibitionNewsData.js';
import { scrapeEventPage, fetchOgImage } from './lib/scraper.js';
import { findNearbyParking } from './lib/parking.js';
import { generatePostForEvent, generatePostForFacilities, generatePostForPolicyNews, generatePostForExhibitionNews } from './lib/generateContent.js';
import { publishPost, fetchTodayPosts } from './lib/blogger.js';
import { getKstDayOfWeek } from './lib/kstDate.js';

const DELAY_BETWEEN_POSTS = 8000;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendDiscordNotification(publishedPosts) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl || !publishedPosts.length) return;
  try {
    const kstNow = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const lines = publishedPosts.map((p, i) => `**${i + 1}.** [${p.title}](${p.url})`).join('\n');
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `📝 **블로그 포스트 발행 완료** (${kstNow})\n${lines}`,
      }),
    });
  } catch (e) {
    console.log(`[discord] 알림 전송 실패 (무시): ${e.message}`);
  }
}

async function sendDiscordError(errorMessage) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    const kstNow = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `⚠️ **블로그 발행 실패** (${kstNow})\n\`\`\`${errorMessage}\`\`\``,
      }),
    });
  } catch (e) {
    console.log(`[discord] 오류 알림 전송 실패 (무시): ${e.message}`);
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

// ─── 오늘 발행된 포스트 제목 목록 조회 (중복 방지) ────────────────────────────

async function getPostedTitlesCount() {
  try {
    const posts = await fetchTodayPosts();
    return { titles: posts.map((p) => p.title), count: posts.length };
  } catch (e) {
    console.log(`[중복방지] 오늘 포스트 조회 실패 (무시): ${e.message}`);
    return { titles: [], count: 0 };
  }
}

// ─── 문화행사 파이프라인 (월/수/금/일 + 기본값) ──────────────────────────────

async function runEventPipeline(alreadyPostedTitles = [], runIndex = 0) {
  const allEvents = await fetchTodayEvents();
  if (allEvents.length === 0) {
    console.log('오늘 진행 중인 행사가 없습니다. 종료합니다.');
    return { count: 0, posts: [], error: null };
  }

  const filtered = allEvents.filter(
    (e) => !alreadyPostedTitles.some((t) => t.includes(e.title.substring(0, 10)))
  );
  if (filtered.length === 0) {
    console.log('오늘 행사가 이미 모두 발행되었습니다. 종료합니다.');
    return { count: 0, posts: [], error: null };
  }

  const featured = selectFeaturedEvents(filtered, 1, runIndex);
  const event = featured[0];
  console.log(`\n[1/1] ${event.title}`);

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
    return { count: 1, posts: [{ title: post.title, url: published.url }], error: null };
  } catch (err) {
    console.error(`  [오류] 행사 포스트 실패: ${err.message}`);
    return { count: 0, posts: [], error: `행사 포스트 실패: ${err.message}` };
  }
}

// ─── 구별 무료공간 파이프라인 (화/목) ────────────────────────────────────────

async function runFacilityPipeline(alreadyPostedCount = 0) {
  if (alreadyPostedCount > 0) {
    console.log('오늘 이미 포스트가 발행되었습니다 (화/목는 하루 1회만). 종료합니다.');
    return { count: 0, posts: [], error: null };
  }

  const allFacilities = await fetchFreeFacilities();
  if (allFacilities.length === 0) {
    console.log('이용 가능한 무료 시설이 없습니다. 종료합니다.');
    return { count: 0, posts: [], error: null };
  }

  // 3개로 시도, 실패 시 2개로 재시도
  for (const facilityCount of [3, 2]) {
    const { district, facilities } = selectFeaturedDistrict(allFacilities, facilityCount);

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
      return { count: 1, posts: [{ title: post.title, url: published.url }], error: null };
    } catch (err) {
      console.error(`  [오류] 무료공간 포스트 실패 (시설 ${facilityCount}개): ${err.message}`);
      if (facilityCount === 2) {
        return { count: 0, posts: [], error: `무료공간 포스트 실패: ${err.message}` };
      }
      console.log('  시설 수 줄여서 재시도합니다...');
    }
  }
}

// ─── 정책뉴스 파이프라인 (토요일) ─────────────────────────────────────────────

async function runPolicyNewsPipeline(alreadyPostedCount = 0) {
  if (alreadyPostedCount > 0) {
    console.log('오늘 이미 포스트가 발행되었습니다 (토는 하루 1회만). 종료합니다.');
    return { count: 0, posts: [], error: null };
  }

  let newsItems;
  try {
    newsItems = await fetchTodayPolicyNews();
  } catch (err) {
    console.log(`[policyNews] 수집 실패 (문화행사로 대체): ${err.message}`);
    return runEventPipeline([]);
  }

  if (newsItems.length < 2) {
    console.log('[policyNews] 관련 뉴스 부족 — 문화행사 파이프라인으로 대체');
    return runEventPipeline([]);
  }

  try {
    const post = await generatePostForPolicyNews(newsItems);
    const published = await publishPost(post);
    return { count: 1, posts: [{ title: post.title, url: published.url }], error: null };
  } catch (err) {
    console.error(`  [오류] 정책뉴스 포스트 실패: ${err.message}`);
    return { count: 0, posts: [], error: `정책뉴스 포스트 실패: ${err.message}` };
  }
}

// ─── 전시 소식 파이프라인 (매일, 4번째 포스팅) ─────────────────────────────────

async function runExhibitionPipeline(alreadyPostedTitles = []) {
  if (alreadyPostedTitles.some((t) => t.includes('전시 소식'))) {
    console.log('오늘 전시 소식이 이미 발행되었습니다. 종료합니다.');
    return { count: 0, posts: [], error: null };
  }

  let newsItems;
  try {
    newsItems = await fetchExhibitionNews();
  } catch (err) {
    console.error(`  [오류] 전시 소식 수집 실패: ${err.message}`);
    return { count: 0, posts: [], error: `전시 소식 수집 실패: ${err.message}` };
  }

  if (newsItems.length < 3) {
    console.log('[exhibitionNews] 채택할 만한 소식 부족 — 오늘은 건너뜁니다.');
    return { count: 0, posts: [], error: null };
  }

  try {
    const withImages = await Promise.all(
      newsItems.map(async (n) => ({ ...n, imageUrl: await fetchOgImage(n.link) }))
    );
    const withImageCount = withImages.filter((n) => n.imageUrl).length;
    console.log(`[exhibitionNews] 이미지 수집: ${withImageCount}/${withImages.length}건`);

    const post = await generatePostForExhibitionNews(withImages);
    const published = await publishPost(post);
    return { count: 1, posts: [{ title: post.title, url: published.url }], error: null };
  } catch (err) {
    console.error(`  [오류] 전시 소식 포스트 실패: ${err.message}`);
    return { count: 0, posts: [], error: `전시 소식 포스트 실패: ${err.message}` };
  }
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== 서울 소식 블로그 자동화 시작 ===');
  console.log(`실행 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);

  const dayOfWeek = getKstDayOfWeek();
  const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
  console.log(`오늘 요일: ${DAY_NAMES[dayOfWeek]}요일`);

  const kstHour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }));
  const runIndex = kstHour >= 15 ? 2 : kstHour >= 12 ? 1 : 0;
  console.log(`실행 순번: ${runIndex + 1}번째 (KST ${kstHour}시)`);

  const { titles: alreadyPostedTitles, count: alreadyPostedCount } = await getPostedTitlesCount();
  if (alreadyPostedCount > 0) {
    console.log(`오늘 이미 발행된 포스트: ${alreadyPostedCount}개`);
  }

  let result;

  if (process.env.FORCE_EXHIBITION === 'true') {
    // 수동 테스트용: 요일/시간 무시하고 전시 소식만 강제 실행, 당일 중복 체크도 건너뜀
    console.log('모드: [강제 실행] 서울 전시 소식');
    result = await runExhibitionPipeline([]);
  } else if (kstHour >= 17) {
    // 4번째 포스팅: 요일과 무관하게 매일 실행
    console.log('모드: 서울 전시 소식 (신규 개막·얼리버드 티켓·개관예정)');
    result = await runExhibitionPipeline(alreadyPostedTitles);
  } else if (dayOfWeek === 2 || dayOfWeek === 4) {
    console.log('모드: 구별 무료 문화 프로그램 모음');
    result = await runFacilityPipeline(alreadyPostedCount);
  } else if (dayOfWeek === 6) {
    console.log('모드: 오늘의 정책뉴스');
    result = await runPolicyNewsPipeline(alreadyPostedCount);
  } else {
    console.log('모드: 오늘의 서울 문화행사');
    result = await runEventPipeline(alreadyPostedTitles, runIndex);
  }

  const { count, posts, error } = result;
  console.log(`\n=== 완료: ${count}개 포스팅 발행 ===`);

  if (error) {
    await sendDiscordError(error);
  } else {
    await sendDiscordNotification(posts);
  }
}

main().catch(async (err) => {
  console.error('[치명적 오류]', err.message);
  await sendDiscordError(`치명적 오류: ${err.message}`);
  process.exit(1);
});
