/**
 * 핫링크 차단 이미지 URL → SVG 썸네일로 교체
 * 실행: node scripts/fix-broken-images.js
 */
import 'dotenv/config';
import { generateThumbnailSvg } from '../lib/thumbnail.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BLOGGER_API = 'https://www.googleapis.com/blogger/v3/blogs';

// 핫링크 차단이 알려진 도메인
const BLOCKED_DOMAINS = [
  'daumcdn.net', 'pstatic.net', 'naver.net',
  'tistory.com', 'kakaocdn.net', 'blogspot.com/proxy',
];

async function getToken() {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  return (await res.json()).access_token;
}

function isBlocked(src) {
  if (src.startsWith('data:')) return false;
  if (src.includes('culture.seoul.go.kr')) return false; // 서울시 공식 이미지, 유지
  return BLOCKED_DOMAINS.some((d) => src.includes(d));
}

function guessCategory(title) {
  if (/LH|SH|공공임대|분양/.test(title)) return 'LH공고';
  if (/청약|임대|주택|분양/.test(title)) return '청약 가이드';
  if (/정책|복지|지원금|혜택/.test(title)) return '정책뉴스';
  if (/문화행사|전시|공연|축제/.test(title)) return '공연';
  return '청약 가이드';
}

function makeSvgTag(title) {
  const category = guessCategory(title);
  const svgUrl = generateThumbnailSvg({ title, category });
  return `<p><img src="${svgUrl}" alt="${title.replace(/"/g, '&quot;')}" width="800" height="800" style="max-width:100%;height:auto;border-radius:8px;" /></p>`;
}

async function main() {
  const blogId = process.env.BLOGGER_BLOG_ID;
  const token = await getToken();

  const res = await fetch(
    `${BLOGGER_API}/${blogId}/posts?maxResults=50&status=live&fetchBodies=true&fields=items(id,title,content)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  const posts = data.items ?? [];
  console.log(`전체 포스트: ${posts.length}개`);

  const imgRe = /<p>\s*<img[^>]+src=["']([^"']+)["'][^>]*\/?>\s*<\/p>/gi;
  let fixed = 0;

  for (const post of posts) {
    let content = post.content ?? '';
    let changed = false;

    const newContent = content.replace(imgRe, (fullMatch, src) => {
      if (!isBlocked(src)) return fullMatch;
      console.log(`\n"${post.title.substring(0, 45)}"`);
      console.log(`  교체: ${src.substring(0, 70)}...`);
      changed = true;
      return makeSvgTag(post.title);
    });

    if (!changed) continue;

    const patchRes = await fetch(`${BLOGGER_API}/${blogId}/posts/${post.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newContent }),
    });

    if (patchRes.ok) { console.log('  ✓ 수정 완료'); fixed++; }
    else { console.error(`  ✗ 실패: ${(await patchRes.text()).substring(0, 100)}`); }

    await new Promise((r) => setTimeout(r, 600));
  }

  console.log(`\n=== 완료: ${fixed}개 수정 ===`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
