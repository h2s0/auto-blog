/**
 * 정책뉴스 포스트 테스트 발행
 * 실행: node scripts/test-policy-post.js
 */
import 'dotenv/config';
import { fetchTodayPolicyNews } from '../lib/policyNewsData.js';
import { generatePostForPolicyNews } from '../lib/generateContent.js';
import { publishPost } from '../lib/blogger.js';
import { generateThumbnailSvg } from '../lib/thumbnail.js';

function prependImage(html, imageUrl, altText) {
  if (!imageUrl) return html;
  const safeAlt = String(altText || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<p><img src="${imageUrl}" alt="${safeAlt}" width="1200" height="630" style="max-width:100%;height:auto;border-radius:8px;" /></p>\n` + html;
}

async function main() {
  const newsItems = await fetchTodayPolicyNews();
  if (newsItems.length < 2) {
    console.log('기사 부족 — 발행 안 함');
    return;
  }

  const post = await generatePostForPolicyNews(newsItems);
  post.labels = post.labels.includes('정책뉴스') ? post.labels : [...post.labels, '정책뉴스'];
  post.html = prependImage(post.html, generateThumbnailSvg({
    title: '오늘의 정책 뉴스',
    subtitle: '서울 시민 생활 정보',
    category: '정책뉴스',
  }), '오늘의 정책 뉴스');

  const published = await publishPost({ title: post.title, html: post.html, labels: post.labels });
  console.log('\n발행 URL:', published.url);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
