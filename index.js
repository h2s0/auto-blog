import 'dotenv/config';
import { fetchTodayEvents } from './lib/seoulData.js';
import { generateBlogPost } from './lib/generateContent.js';
import { publishPost } from './lib/blogger.js';

async function main() {
  console.log('=== 서울 소식 블로그 자동화 시작 ===');
  console.log(`실행 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);

  // 1단계: 서울 문화행사 수집
  const events = await fetchTodayEvents();
  if (events.length === 0) {
    console.log('오늘 진행 중인 행사가 없습니다. 종료합니다.');
    process.exit(0);
  }

  // 2단계: Gemini로 블로그 원고 생성
  const post = await generateBlogPost(events);

  // 3단계: Blogger에 발행
  await publishPost(post);

  console.log('=== 완료 ===');
}

main().catch((err) => {
  console.error('[오류]', err.message);
  process.exit(1);
});
