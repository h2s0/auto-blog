/**
 * 기존 Blogger 포스트의 합쳐진 구이름 라벨을 분리하는 일회성 마이그레이션 스크립트
 * 실행: node scripts/fix-labels.js
 *
 * "마포구 데이트" → ["마포구", "데이트"]
 * "종로구 무료 강연" → ["종로구", "무료 강연"]
 */

import 'dotenv/config';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BLOGGER_API = 'https://www.googleapis.com/blogger/v3/blogs';
const DELAY_MS = 500;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getAccessToken() {
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
  const data = await res.json();
  if (!data.access_token) throw new Error(`토큰 발급 실패: ${JSON.stringify(data)}`);
  return data.access_token;
}

// "[구이름] [나머지]" 패턴이면 두 개로 분리, 아니면 null 반환
function trySplitLabel(label) {
  const match = label.match(/^(\S+구)\s+(.+)$/);
  return match ? [match[1], match[2]] : null;
}

function processLabels(labels) {
  const result = [];
  let changed = false;

  for (const label of labels) {
    const parts = trySplitLabel(label);
    if (parts) {
      result.push(...parts);
      changed = true;
    } else {
      result.push(label);
    }
  }

  // 중복 제거
  const deduped = [...new Set(result)];
  return { labels: deduped, changed };
}

async function fetchAllPosts(blogId, token) {
  const posts = [];
  let pageToken = null;

  do {
    const params = new URLSearchParams({
      maxResults: '500',
      status: 'live',
      fetchBodies: 'false',
      fields: 'nextPageToken,items(id,title,labels)',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`${BLOGGER_API}/${blogId}/posts?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    posts.push(...(data.items ?? []));
    pageToken = data.nextPageToken ?? null;
  } while (pageToken);

  return posts;
}

async function patchLabels(blogId, postId, labels, token) {
  const res = await fetch(`${BLOGGER_API}/${blogId}/posts/${postId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ labels }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PATCH 실패 (${res.status}): ${err.substring(0, 200)}`);
  }
  return res.json();
}

async function main() {
  const blogId = process.env.BLOGGER_BLOG_ID;
  if (!blogId) throw new Error('BLOGGER_BLOG_ID 없음');

  console.log('=== Blogger 라벨 마이그레이션 시작 ===');
  const token = await getAccessToken();

  console.log('포스트 목록 수집 중...');
  const posts = await fetchAllPosts(blogId, token);
  console.log(`전체 포스트: ${posts.length}개`);

  let updated = 0;
  let skipped = 0;

  for (const post of posts) {
    const labels = post.labels ?? [];
    const { labels: newLabels, changed } = processLabels(labels);

    if (!changed) {
      skipped++;
      continue;
    }

    const splitInfo = labels
      .filter((l) => trySplitLabel(l))
      .map((l) => {
        const [a, b] = trySplitLabel(l);
        return `"${l}" → ["${a}", "${b}"]`;
      })
      .join(', ');

    console.log(`\n[${updated + 1}] "${post.title}"`);
    console.log(`  변경: ${splitInfo}`);
    console.log(`  이전: ${JSON.stringify(labels)}`);
    console.log(`  이후: ${JSON.stringify(newLabels)}`);

    try {
      await patchLabels(blogId, post.id, newLabels, token);
      console.log('  ✓ 업데이트 완료');
      updated++;
    } catch (err) {
      console.error(`  ✗ 실패: ${err.message}`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n=== 완료: ${updated}개 업데이트, ${skipped}개 변경 없음 ===`);
}

main().catch((err) => {
  console.error('[오류]', err.message);
  process.exit(1);
});
