/**
 * Blogger API v3로 포스트 발행
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BLOGGER_API = 'https://www.googleapis.com/blogger/v3/blogs';

// 초안으로 발행할지 여부 (true → 초안, false → 즉시 공개)
const IS_DRAFT = process.env.BLOGGER_IS_DRAFT !== 'false';

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

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OAuth 토큰 갱신 실패 (${res.status}): ${errText}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`access_token이 없습니다: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

// 오늘 발행된 포스트 목록 조회 (중복 방지용)
export async function fetchTodayPosts() {
  const blogId = process.env.BLOGGER_BLOG_ID;
  if (!blogId) return [];

  const accessToken = await getAccessToken();
  const kstNow = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).substring(0, 10);

  // 최근 5개 포스트 조회 후 오늘 날짜인 것만 필터 (live + draft 모두)
  const url = `${BLOGGER_API}/${blogId}/posts?maxResults=5&status=live&status=draft&fetchBodies=false`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];

  const data = await res.json();
  const items = data.items ?? [];
  return items.filter((p) => {
    const published = p.published ?? p.updated ?? '';
    const kstPublished = new Date(published).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).substring(0, 10);
    return kstPublished === kstNow;
  });
}

export async function publishPost({ title, html, labels }) {
  const blogId = process.env.BLOGGER_BLOG_ID;
  if (!blogId) throw new Error('BLOGGER_BLOG_ID 환경변수가 없습니다.');
  if (!process.env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID 환경변수가 없습니다.');
  if (!process.env.GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_SECRET 환경변수가 없습니다.');
  if (!process.env.GOOGLE_REFRESH_TOKEN) throw new Error('GOOGLE_REFRESH_TOKEN 환경변수가 없습니다.');

  console.log('[blogger] OAuth 액세스 토큰 발급 중...');
  const accessToken = await getAccessToken();

  const url = `${BLOGGER_API}/${blogId}/posts?isDraft=${IS_DRAFT}`;
  console.log(`[blogger] 포스트 발행 중 (isDraft=${IS_DRAFT})...`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, content: html, labels }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Blogger API 오류 (${res.status}): ${errText}`);
  }

  const post = await res.json();
  console.log(`[blogger] 저장 완료!`);
  console.log(`  제목: ${post.title}`);
  console.log(`  상태: ${post.status}`);
  console.log(`  URL: ${post.url}`);
  return post;
}
