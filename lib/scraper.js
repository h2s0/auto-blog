const TIMEOUT_MS = 10000;

function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 4000);
}

function extractOgImage(html) {
  const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return match?.[1] ?? null;
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function scrapeEventPage(url) {
  if (!url) return { text: null, ogImage: null };

  try {
    const html = await fetchHtml(url);
    if (!html) return { text: null, ogImage: null };

    const text = extractText(html);
    const ogImage = extractOgImage(html);

    console.log(`[scraper] 크롤링 완료 (${text.length}자${ogImage ? ', og:image 있음' : ''}): ${url}`);
    return { text, ogImage };
  } catch (e) {
    console.log(`[scraper] 크롤링 실패 (무시하고 진행): ${e.message}`);
    return { text: null, ogImage: null };
  }
}

// 텍스트는 필요 없고 og:image만 필요할 때 (예: 뉴스 링크 목록에서 썸네일만 수집)
export async function fetchOgImage(url) {
  if (!url) return null;
  try {
    const html = await fetchHtml(url);
    if (!html) return null;
    return extractOgImage(html);
  } catch (e) {
    console.log(`[scraper] og:image 수집 실패 (무시하고 진행): ${url} — ${e.message}`);
    return null;
  }
}
