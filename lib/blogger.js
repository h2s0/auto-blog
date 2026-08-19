/**
 * Blogger API v3로 포스트 발행
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BLOGGER_API = 'https://www.googleapis.com/blogger/v3/blogs';

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

/**
 * 최근 N일 발행된 포스트 제목 목록 반환 (이벤트 중복 방지용)
 */
export async function fetchRecentTitles(days = 7) {
  const blogId = process.env.BLOGGER_BLOG_ID;
  if (!blogId) return [];

  const accessToken = await getAccessToken();

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const url = `${BLOGGER_API}/${blogId}/posts?maxResults=50&status=live&fetchBodies=false&startDate=${startDate.toISOString()}&fields=items(title,published)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

  if (!res.ok) {
    console.log(`[blogger] 최근 포스트 조회 실패 (${res.status}) — 중복 방지 건너뜀`);
    return [];
  }

  const data = await res.json();
  const items = data.items ?? [];
  console.log(`[blogger] 최근 ${days}일 포스트: ${items.length}개`);
  return items.map((p) => p.title);
}

/**
 * 포스트 발행.
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.html
 * @param {string[]} [opts.labels]
 * @param {Date|null} [opts.scheduledAt] - 미래 시각이면 Blogger 예약 발행으로 처리
 */
export async function publishPost({ title, html, labels, scheduledAt = null }) {
  const blogId = process.env.BLOGGER_BLOG_ID;
  if (!blogId) throw new Error('BLOGGER_BLOG_ID 환경변수가 없습니다.');
  if (!process.env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID 환경변수가 없습니다.');
  if (!process.env.GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_SECRET 환경변수가 없습니다.');
  if (!process.env.GOOGLE_REFRESH_TOKEN) throw new Error('GOOGLE_REFRESH_TOKEN 환경변수가 없습니다.');

  console.log('[blogger] OAuth 액세스 토큰 발급 중...');
  const accessToken = await getAccessToken();

  const isScheduled = scheduledAt && scheduledAt > new Date();
  const url = `${BLOGGER_API}/${blogId}/posts?isDraft=false`;

  const body = { title, content: html, labels };
  if (isScheduled) {
    body.published = scheduledAt.toISOString();
  }

  console.log(`[blogger] 포스트 발행 중${isScheduled ? ` (예약: ${scheduledAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})` : ''}...`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Blogger API 오류 (${res.status}): ${errText}`);
  }

  const post = await res.json();
  console.log('[blogger] 저장 완료!');
  console.log(`  제목: ${post.title}`);
  console.log(`  상태: ${post.status}`);
  console.log(`  URL: ${post.url}`);
  return post;
}
