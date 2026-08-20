import 'dotenv/config';
import { readFileSync } from 'fs';
import { fetchTodayEvents, selectFeaturedEvents } from './lib/seoulData.js';
import { fetchTodayPolicyNews } from './lib/policyNewsData.js';
import { fetchLhNotices } from './lib/lhData.js';
import { scrapeEventPage } from './lib/scraper.js';
import { findNearbyParking } from './lib/parking.js';
import {
  generatePostForEvent,
  generatePostForPolicyNews,
  generatePostForCheongyakGuide,
  generatePostForLhNotice,
} from './lib/generateContent.js';
import { publishPost, fetchRecentTitles } from './lib/blogger.js';
import { generateThumbnailSvg } from './lib/thumbnail.js';
import { getPostImage } from './lib/imageSearch.js';

const CHEONGYAK_TOPICS = JSON.parse(readFileSync(new URL('./topics-cheongyak.json', import.meta.url)));

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

function prependImage(html, imageUrl, altText) {
  if (!imageUrl) return html;
  const safeAlt = String(altText || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<p><img src="${imageUrl}" alt="${safeAlt}" width="1200" height="630" style="max-width:100%;height:auto;border-radius:8px;" /></p>\n` + html;
}

function ensureLabel(labels, label) {
  return labels.includes(label) ? labels : [...labels, label];
}

// h2 앞에 빈 줄 2개 삽입 (첫 번째 제외) — 섹션 간 가독성 개선
function addHeadingBreaks(html) {
  let first = true;
  return html.replace(/<h2/g, (match) => {
    if (first) { first = false; return match; }
    return '<p><br></p><p><br></p>' + match;
  });
}

/**
 * KST 기준 오늘 날짜 문자열로 예약 시각 Date 반환
 * @param {string} kstDateStr - "2026-08-20"
 * @param {number} hour - 9, 12, 15, 18
 */
function scheduleAt(kstDateStr, hour) {
  return new Date(`${kstDateStr}T${String(hour).padStart(2, '0')}:00:00+09:00`);
}

async function sendDiscordNotification(publishedPosts) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl || !publishedPosts.length) return;
  try {
    const kstNow = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const lines = publishedPosts.map((p) => `• [${p.title}](${p.url}) → ${p.scheduledLabel}`).join('\n');
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `📝 **오늘 예약 발행 완료** (${kstNow})\n${lines}` }),
    });
  } catch (e) {
    console.log(`[discord] 알림 전송 실패 (무시): ${e.message}`);
  }
}

async function sendDiscordError(msg) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `⚠️ **발행 실패** (${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})\n\`\`\`${msg}\`\`\`` }),
    });
  } catch (e) {
    console.log(`[discord] 오류 알림 실패 (무시): ${e.message}`);
  }
}

// ─── 슬롯 1: 서울 문화행사 (09:00) ───────────────────────────────────────────

async function buildEventPost(recentTitles) {
  let allEvents;
  try {
    allEvents = await fetchTodayEvents();
  } catch (err) {
    console.log(`[seoulData] API 오류: ${err.message}`);
    return null;
  }

  if (!allEvents.length) {
    console.log('[slot1] 오늘 진행 행사 없음 — 건너뜀');
    return null;
  }

  // 최근 7일 내 이미 발행한 행사 제목 앞 15자로 중복 제거
  const filtered = allEvents.filter(
    (e) => !recentTitles.some((t) => t.includes(e.title.substring(0, 15)))
  );
  if (!filtered.length) {
    console.log('[slot1] 새 행사 없음 (7일 내 중복) — 건너뜀');
    return null;
  }

  const event = selectFeaturedEvents(filtered, 1, 0)[0];
  console.log(`[slot1] 선택 행사: ${event.title} (${event.district})`);

  const [{ text: scrapedText, ogImage }, parkingLots] = await Promise.all([
    scrapeEventPage(event.orgLink),
    findNearbyParking(event.place, 3, { lat: event.lat, lon: event.lon }),
  ]);

  const post = await generatePostForEvent(event, scrapedText, parkingLots);
  post.labels = ensureLabel(post.labels, '서울 문화행사');

  const imageUrl = event.imageUrl || ogImage
    || generateThumbnailSvg({ title: event.title, category: event.category, district: event.district, isFree: event.isFree });
  post.html = prependImage(addHeadingBreaks(post.html), imageUrl, event.title);
  return post;
}

// ─── 슬롯 2: 청약 가이드 (12:00) ─────────────────────────────────────────────

async function buildCheongyakPost(recentTitles) {
  let topicIndex = Math.floor(Date.now() / 86400000) % CHEONGYAK_TOPICS.length;
  let topic = CHEONGYAK_TOPICS[topicIndex];

  // 최근 7일 내 같은 주제가 이미 있으면 다음 토픽
  if (recentTitles.some((t) => t.includes(topic.substring(0, 8)))) {
    topicIndex = (topicIndex + 1) % CHEONGYAK_TOPICS.length;
    topic = CHEONGYAK_TOPICS[topicIndex];
    console.log(`[slot2] 중복 주제 → 다음 토픽으로: "${topic}"`);
  }
  console.log(`[slot2] 청약 가이드 주제: "${topic}"`);

  const post = await generatePostForCheongyakGuide(topic);
  post.labels = ensureLabel(post.labels, '청약·부동산');
  post.html = prependImage(addHeadingBreaks(post.html), generateThumbnailSvg({
    title: topic, subtitle: '청약 가이드', category: '청약 가이드',
  }), topic);
  return post;
}

// ─── 슬롯 3: 서울 정책·복지 뉴스 (15:00) ────────────────────────────────────

async function buildPolicyPost() {
  let newsItems;
  try {
    newsItems = await fetchTodayPolicyNews();
  } catch (err) {
    console.log(`[slot3] 정책뉴스 수집 실패: ${err.message}`);
    return null;
  }

  if (!newsItems || newsItems.length < 1) {
    console.log('[slot3] 정책뉴스 없음 — 건너뜀');
    return null;
  }

  console.log(`[slot3] 정책뉴스 ${newsItems.length}건 수집`);
  const post = await generatePostForPolicyNews(newsItems);
  post.labels = ensureLabel(post.labels, '정책뉴스');
  post.html = prependImage(addHeadingBreaks(post.html), generateThumbnailSvg({
    title: '오늘의 정책 뉴스', subtitle: '서울 시민 생활 정보', category: '정책뉴스',
  }), '오늘의 정책 뉴스');
  return post;
}

// ─── 슬롯 4: LH·SH 청약 공고 (18:00) ────────────────────────────────────────

async function buildLhPost(recentTitles) {
  let notices;
  try {
    notices = await fetchLhNotices();
  } catch (err) {
    console.log(`[slot4] LH 수집 실패: ${err.message}`);
    return buildCheongyakPost(recentTitles);
  }

  if (!notices.length) {
    console.log('[slot4] LH 공고 없음 → 청약가이드로 대체');
    return buildCheongyakPost(recentTitles);
  }

  console.log(`[slot4] LH 공고 ${notices.length}건`);
  const post = await generatePostForLhNotice(notices);
  post.labels = ensureLabel(post.labels, '청약·부동산');
  post.html = prependImage(addHeadingBreaks(post.html), generateThumbnailSvg({
    title: 'LH·SH 청약 공고', subtitle: '공공임대·분양 신청 정보', category: 'LH공고',
  }), 'LH·SH 청약 공고');
  return post;
}

// ─── 메인 (하루 1회 실행, 4슬롯 예약 발행) ───────────────────────────────────

async function main() {
  console.log('=== 서울 소식 블로그 자동화 시작 ===');
  const kstNow = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`실행 시각 (KST): ${kstNow}`);

  // KST 오늘 날짜 문자열 (예약 시각 계산용)
  const kstDateStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

  // 최근 7일 발행 제목 수집 (이벤트 중복 방지)
  let recentTitles = [];
  try {
    recentTitles = await fetchRecentTitles(7);
  } catch (e) {
    console.log(`[중복방지] 조회 실패 (무시): ${e.message}`);
  }

  // 이번 실행 중 발행된 제목 누적 (recentTitles 포함) → 슬롯 간 중복 방지
  const publishedTitles = [...recentTitles];

  // 4개 슬롯 정의: { hour, label, build }
  const slots = [
    { hour: 9,  label: '09:00 서울 문화행사',    build: () => buildEventPost(publishedTitles) },
    { hour: 12, label: '12:00 청약 가이드',       build: () => buildCheongyakPost(publishedTitles) },
    { hour: 15, label: '15:00 서울 정책·복지',    build: () => buildPolicyPost() },
    { hour: 18, label: '18:00 LH·SH 청약 공고',   build: () => buildLhPost(publishedTitles) },
  ];

  const published = [];
  const errors = [];

  for (const slot of slots) {
    console.log(`\n--- ${slot.label} ---`);
    try {
      const post = await slot.build();
      if (!post) {
        console.log('  → 발행할 내용 없음, 건너뜀');
        continue;
      }

      const publishTime = scheduleAt(kstDateStr, slot.hour);
      const result = await publishPost({ ...post, scheduledAt: publishTime });
      published.push({ title: result.title, url: result.url, scheduledLabel: slot.label });
      publishedTitles.push(result.title); // 다음 슬롯 중복 체크에 포함
    } catch (err) {
      console.error(`  [오류] ${slot.label}: ${err.message}`);
      errors.push(`${slot.label}: ${err.message}`);
    }
  }

  console.log(`\n=== 완료: ${published.length}개 예약 발행 ===`);

  if (errors.length) {
    await sendDiscordError(errors.join('\n'));
  }
  if (published.length) {
    await sendDiscordNotification(published);
  }
}

main().catch(async (err) => {
  console.error('[치명적 오류]', err.message);
  await sendDiscordError(`치명적 오류: ${err.message}`);
  process.exit(1);
});
