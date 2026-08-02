import 'dotenv/config';
import { fetchTodayEvents, selectFeaturedEvents } from './lib/seoulData.js';
import { scrapeEventPage } from './lib/scraper.js';
import { generatePostForEvent } from './lib/generateContent.js';
import { publishPost } from './lib/blogger.js';

const POSTS_PER_DAY = 3;
// Gemini 무료 티어 분당 요청 제한 방어용 대기 (ms)
const DELAY_BETWEEN_POSTS = 8000;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('=== 서울 소식 블로그 자동화 시작 ===');
  console.log(`실행 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);

  // 1단계: 오늘 행사 수집 + 포스팅 대상 3개 선택
  const allEvents = await fetchTodayEvents();
  if (allEvents.length === 0) {
    console.log('오늘 진행 중인 행사가 없습니다. 종료합니다.');
    process.exit(0);
  }
  const featured = selectFeaturedEvents(allEvents, POSTS_PER_DAY);

  // 2~3단계: 각 행사별 크롤링 → 원고 생성 → 발행
  let successCount = 0;
  for (let i = 0; i < featured.length; i++) {
    const event = featured[i];
    console.log(`\n[${i + 1}/${featured.length}] ${event.title}`);

    try {
      // 공식 페이지 크롤링
      const scrapedText = await scrapeEventPage(event.orgLink);

      // Gemini로 상세 포스트 생성
      const post = await generatePostForEvent(event, scrapedText);

      // Blogger 발행
      await publishPost(post);
      successCount++;
    } catch (err) {
      console.error(`  [오류] 이 행사 건너뜀: ${err.message}`);
    }

    // 마지막 행사가 아니면 잠시 대기 (API 제한 방어)
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
