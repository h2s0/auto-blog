import 'dotenv/config';
import { readFileSync } from 'fs';
import { fetchTodayEvents, selectFeaturedEvents } from './lib/seoulData.js';
import { fetchFreeFacilities, selectFeaturedDistrict } from './lib/seoulFacilityData.js';
import { fetchTodayPolicyNews } from './lib/policyNewsData.js';
import { fetchLhNotices } from './lib/lhData.js';
import { scrapeEventPage } from './lib/scraper.js';
import { findNearbyParking } from './lib/parking.js';
import { generatePostForEvent, generatePostForFacilities, generatePostForPolicyNews, generatePostForCheongyakGuide, generatePostForLhNotice } from './lib/generateContent.js';
import { publishPost, fetchTodayPosts } from './lib/blogger.js';
import { generateThumbnailSvg } from './lib/thumbnail.js';

const CHEONGYAK_TOPICS = JSON.parse(readFileSync(new URL('./topics-cheongyak.json', import.meta.url)));

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
  const safeAlt = String(altText || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const img = `<p><img src="${imageUrl}" alt="${safeAlt}" width="1200" height="630" style="max-width:100%;height:auto;border-radius:8px;" /></p>\n`;
  return img + html;
}

// 카테고리 라벨이 없으면 추가
function ensureLabel(labels, label) {
  return labels.includes(label) ? labels : [...labels, label];
}

// 무료공간 포스트: h3 앞에 줄바꿈 + h3 뒤에 시설별 이미지 삽입
function insertFacilityExtras(html, facilities) {
  let idx = 0;
  return html.replace(/<h3>([\s\S]*?)<\/h3>/g, (match) => {
    const isFirst = idx === 0;
    const f = facilities[idx] || null;
    idx++;

    const breakHtml = isFirst ? '' : '\n<p><br></p>\n';
    if (!f) return `${breakHtml}${match}`;

    const imageUrl = f.imageUrl || generateThumbnailSvg({
      title: f.name || '',
      subtitle: f.targetAudience || f.place || '',
      category: '무료 프로그램',
    });
    const safeAlt = (f.name || '').replace(/"/g, '&quot;');
    const imgHtml = `\n<p><img src="${imageUrl}" alt="${safeAlt}" width="1200" height="630" style="max-width:100%;height:auto;border-radius:8px;" /></p>`;

    return `${breakHtml}${match}${imgHtml}`;
  });
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
  let allEvents;
  try {
    allEvents = await fetchTodayEvents();
  } catch (err) {
    console.log(`[seoulData] API 오류 — 청약가이드로 대체: ${err.message}`);
    return runCheongyakGuidePipeline();
  }

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
    post.labels = ensureLabel(post.labels, '서울 문화행사');

    const imageUrl = pickImage(event, ogImage);
    if (imageUrl) {
      post.html = prependImage(post.html, imageUrl, event.title);
      console.log(`  이미지 첨부: ${imageUrl}`);
    } else {
      const thumbUrl = generateThumbnailSvg({
        title: event.title,
        category: event.category,
        district: event.district,
        isFree: event.isFree,
      });
      post.html = prependImage(post.html, thumbUrl, event.title);
      console.log('  SVG 썸네일 생성');
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
      post.labels = ensureLabel(post.labels, '무료 문화 프로그램');

      // 시설별 줄바꿈 + 개별 이미지
      post.html = insertFacilityExtras(post.html, facilities);
      // 포스트 상단 대표 썸네일
      post.html = prependImage(post.html, generateThumbnailSvg({
        title: `${district} 무료 문화 프로그램`,
        category: '무료 프로그램',
        district,
      }), `${district} 무료 문화 프로그램`);
      console.log(`  시설별 이미지 삽입: ${facilities.length}개`);

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

// ─── 청약 가이드 파이프라인 (매일 11:00) ─────────────────────────────────────

async function runCheongyakGuidePipeline(alreadyPostedTitles = []) {
  let topicIndex = Math.floor(Date.now() / 86400000) % CHEONGYAK_TOPICS.length;
  let topic = CHEONGYAK_TOPICS[topicIndex];

  // 오늘 이미 같은 청약 주제가 발행됐으면 다음 주제 사용
  if (alreadyPostedTitles.some((t) => t.includes(topic.substring(0, 8)))) {
    topicIndex = (topicIndex + 1) % CHEONGYAK_TOPICS.length;
    topic = CHEONGYAK_TOPICS[topicIndex];
    console.log(`  중복 주제 감지 — 다음 주제로 대체: "${topic}"`);
  }
  console.log(`모드: 청약 가이드 — 오늘 주제: "${topic}"`);

  try {
    const post = await generatePostForCheongyakGuide(topic);
    post.labels = ensureLabel(post.labels, '청약·부동산');
    post.html = prependImage(post.html, generateThumbnailSvg({
      title: topic,
      subtitle: '청약 가이드',
      category: '청약 가이드',
    }), topic);
    console.log('  SVG 썸네일 생성');
    const published = await publishPost(post);
    return { count: 1, posts: [{ title: post.title, url: published.url }], error: null };
  } catch (err) {
    console.error(`  [오류] 청약가이드 포스트 실패: ${err.message}`);
    return { count: 0, posts: [], error: `청약가이드 포스트 실패: ${err.message}` };
  }
}

// ─── LH 공고 파이프라인 (매일 18:00) ─────────────────────────────────────────

async function runLhNoticePipeline(alreadyPostedTitles = []) {
  console.log('모드: LH·SH 청약 공고');

  let notices;
  try {
    notices = await fetchLhNotices();
  } catch (err) {
    console.log(`[lhData] 수집 실패 (청약가이드로 대체): ${err.message}`);
    return runCheongyakGuidePipeline(alreadyPostedTitles);
  }

  if (!notices.length) {
    console.log('[lhData] 공고 없음 — 청약가이드 파이프라인으로 대체');
    return runCheongyakGuidePipeline(alreadyPostedTitles);
  }

  try {
    const post = await generatePostForLhNotice(notices);
    post.labels = ensureLabel(post.labels, '청약·부동산');
    post.html = prependImage(post.html, generateThumbnailSvg({
      title: 'LH·SH 청약 공고',
      subtitle: '공공임대·분양 신청 정보',
      category: 'LH공고',
    }), 'LH·SH 청약 공고');
    console.log('  SVG 썸네일 생성');
    const published = await publishPost(post);
    return { count: 1, posts: [{ title: post.title, url: published.url }], error: null };
  } catch (err) {
    console.error(`  [오류] LH공고 포스트 실패: ${err.message}`);
    return { count: 0, posts: [], error: `LH공고 포스트 실패: ${err.message}` };
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
    post.labels = ensureLabel(post.labels, '정책뉴스');
    post.html = prependImage(post.html, generateThumbnailSvg({
      title: '오늘의 정책 뉴스',
      subtitle: '서울 시민 생활 정보',
      category: '정책뉴스',
    }), '오늘의 정책 뉴스');
    console.log('  SVG 썸네일 생성');
    const published = await publishPost(post);
    return { count: 1, posts: [{ title: post.title, url: published.url }], error: null };
  } catch (err) {
    console.error(`  [오류] 정책뉴스 포스트 실패: ${err.message}`);
    return { count: 0, posts: [], error: `정책뉴스 포스트 실패: ${err.message}` };
  }
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== 서울 소식 블로그 자동화 시작 ===');
  console.log(`실행 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);

  const dayOfWeek = new Date().getDay();
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

  if (kstHour === 11) {
    result = await runCheongyakGuidePipeline(alreadyPostedTitles);
  } else if (kstHour === 18) {
    result = await runLhNoticePipeline(alreadyPostedTitles);
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
