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

export async function scrapeEventPage(url) {
  if (!url) return { text: null, ogImage: null };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
    });
    clearTimeout(timer);

    if (!res.ok) return { text: null, ogImage: null };

    const html = await res.text();
    const text = extractText(html);
    const ogImage = extractOgImage(html);

    console.log(`[scraper] 크롤링 완료 (${text.length}자${ogImage ? ', og:image 있음' : ''}): ${url}`);
    return { text, ogImage };
  } catch (e) {
    console.log(`[scraper] 크롤링 실패 (무시하고 진행): ${e.message}`);
    return { text: null, ogImage: null };
  }
}
