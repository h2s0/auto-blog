import 'dotenv/config';
import { fetchTodayEvents, selectFeaturedEvents } from './lib/seoulData.js';
import { scrapeEventPage } from './lib/scraper.js';
import { generatePostForEvent } from './lib/generateContent.js';
import { publishPost } from './lib/blogger.js';

const POSTS_PER_DAY = 3;
const DELAY_BETWEEN_POSTS = 8000;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 서울 API imageUrl → og:image 순으로 썸네일 결정
function pickImage(event, ogImage) {
  return event.imageUrl || ogImage || null;
}

// 이미지를 포스트 HTML 맨 앞에 삽입
function prependImage(html, imageUrl, altText) {
  if (!imageUrl) return html;
  const img = `<p><img src="${imageUrl}" alt="${altText}" style="max-width:100%;height:auto;border-radius:8px;" /></p>\n`;
  return img + html;
}

async function main() {
  console.log('=== 서울 소식 블로그 자동화 시작 ===');
  console.log(`실행 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);

  const allEvents = await fetchTodayEvents();
  if (allEvents.length === 0) {
    console.log('오늘 진행 중인 행사가 없습니다. 종료합니다.');
    process.exit(0);
  }
  const featured = selectFeaturedEvents(allEvents, POSTS_PER_DAY);

  let successCount = 0;
  for (let i = 0; i < featured.length; i++) {
    const event = featured[i];
    console.log(`\n[${i + 1}/${featured.length}] ${event.title}`);

    try {
      const { text: scrapedText, ogImage } = await scrapeEventPage(event.orgLink);
      const post = await generatePostForEvent(event, scrapedText);

      // 이미지 선택 및 삽입
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

  console.log(`\n=== 완료: ${successCount}/${featured.length}개 포스팅 발행 ===`);
}

main().catch((err) => {
  console.error('[치명적 오류]', err.message);
  process.exit(1);
});
