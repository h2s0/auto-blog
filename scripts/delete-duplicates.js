/**
 * 중복 포스트 삭제 스크립트
 * 실행: node scripts/delete-duplicates.js
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

async function main() {
  const blogId = process.env.BLOGGER_BLOG_ID;
  const token = await getToken();

  const res = await fetch(
    `${BLOGGER_API}/${blogId}/posts?maxResults=100&status=live&fetchBodies=false&fields=items(id,title,published,url)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  const posts = (data.items ?? []).sort((a, b) => new Date(b.published) - new Date(a.published));

  console.log(`전체 포스트: ${posts.length}개\n`);

  // 앞 25자로 그룹핑해 중복 탐지
  const groups = new Map();
  for (const post of posts) {
    const key = post.title.trim().substring(0, 25);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(post);
  }

  let deleted = 0;
  for (const [key, group] of groups) {
    if (group.length <= 1) continue;

    // 최신 1개 유지, 나머지 삭제
    const keep = group[0];
    const dupes = group.slice(1);

    console.log(`[중복] "${key}..."`);
    console.log(`  유지 → ${keep.published.split('T')[0]}  ${keep.url}`);

    for (const dupe of dupes) {
      console.log(`  삭제 → ${dupe.published.split('T')[0]}  ${dupe.url}`);
      const del = await fetch(`${BLOGGER_API}/${blogId}/posts/${dupe.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (del.ok || del.status === 204) {
        console.log('    ✓');
        deleted++;
      } else {
        console.error(`    ✗ ${del.status}: ${await del.text()}`);
      }
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  console.log(`\n=== 완료: ${deleted}개 중복 삭제 ===`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
