/**
 * 기존 포스트에 상위 카테고리 라벨 추가
 * 실행: node scripts/add-category-labels.js
 */

import 'dotenv/config';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BLOGGER_API = 'https://www.googleapis.com/blogger/v3/blogs';

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

function detectCategory(title, labels) {
  const t = title || '';
  const l = (labels || []).join(',');
  if (/모음|무료 문화 프로그램/.test(t)) return '무료 문화 프로그램';
  if (/청약|LH·SH/.test(t)) return '청약·부동산';
  if (/정책 뉴스|정책뉴스/.test(t)) return '정책뉴스';
  if (/서울 무료 문화 프로그램/.test(l)) return '무료 문화 프로그램';
  if (/청약/.test(l)) return '청약·부동산';
  return '서울 문화행사';
}

async function main() {
  const blogId = process.env.BLOGGER_BLOG_ID;
  const token = await getToken();

  console.log('=== 카테고리 라벨 마이그레이션 시작 ===');
  const res = await fetch(
    `${BLOGGER_API}/${blogId}/posts?maxResults=500&status=live&fetchBodies=false&fields=nextPageToken,items(id,title,labels)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  const posts = data.items ?? [];
  console.log(`전체 포스트: ${posts.length}개`);

  let updated = 0, skipped = 0;

  for (const post of posts) {
    const category = detectCategory(post.title, post.labels);
    const labels = post.labels ?? [];

    if (labels.includes(category)) { skipped++; continue; }

    const newLabels = [...labels, category];
    console.log(`\n"${post.title.substring(0, 50)}..."`);
    console.log(`  → 카테고리: "${category}" 추가`);

    const patchRes = await fetch(`${BLOGGER_API}/${blogId}/posts/${post.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: newLabels }),
    });

    if (patchRes.ok) { updated++; console.log('  ✓ 완료'); }
    else { const e = await patchRes.text(); console.error(`  ✗ 실패: ${e.substring(0, 100)}`); }

    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n=== 완료: ${updated}개 업데이트, ${skipped}개 이미 있음 ===`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
