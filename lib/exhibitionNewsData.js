/**
 * 서울 전시 소식 수집 (구글 뉴스 RSS)
 * 공식 API가 없는 영역이라 news.google.com RSS 검색을 소스로 사용.
 * 인증 불필요, 무료.
 */

import { getKstDateString } from './kstDate.js';

const RSS_BASE = 'https://news.google.com/rss/search';
const RECENT_DAYS = 10;

// 검색 키워드 — 신규 개막·얼리버드 티켓·개관예정 위주
const QUERIES = [
  '서울 전시 개막',
  '서울 미술관 개관',
  '전시 얼리버드 티켓',
  '서울 갤러리 신작 전시',
];

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractTag(xml, tag) {
  // 예: <source url="https://...">이름</source> 처럼 속성이 붙는 태그도 매칭
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`));
  if (!m) return '';
  return decodeEntities(
    m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim()
  );
}

function parseItems(xml) {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return blocks
    .map((block) => ({
      title: extractTag(block, 'title'),
      link: extractTag(block, 'link'),
      pubDate: extractTag(block, 'pubDate'),
      source: extractTag(block, 'source'),
    }))
    .filter((it) => it.title && it.link);
}

async function fetchQuery(query) {
  const url = `${RSS_BASE}?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`Google News RSS HTTP error: ${res.status}`);
  return parseItems(await res.text());
}

function isRecent(pubDate) {
  const d = new Date(pubDate);
  if (isNaN(d)) return true; // 파싱 실패 시 배제하지 않음
  const diffDays = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= RECENT_DAYS;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((it) => {
    const key = it.title.replace(/\s+/g, '').substring(0, 30);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchExhibitionNews() {
  console.log(`[exhibitionNews] ${getKstDateString()} 기준 전시 소식 수집 시작`);

  const results = await Promise.all(
    QUERIES.map((q) =>
      fetchQuery(q).catch((e) => {
        console.log(`[exhibitionNews] "${q}" 조회 실패 (무시): ${e.message}`);
        return [];
      })
    )
  );

  const all = results.flat();
  const recent = all.filter((it) => isRecent(it.pubDate));
  const unique = dedupe(recent).slice(0, 15);

  console.log(
    `[exhibitionNews] 전체 ${all.length}건 → 최근 ${RECENT_DAYS}일 ${recent.length}건 → 중복제거 ${unique.length}건`
  );
  return unique;
}
