/**
 * 이미지 없는 포스트용 SVG 썸네일 생성기
 * 카테고리별 테마 색상 + 제목/구이름/뱃지 구성
 */

const THEMES = {
  '전시/미술':    { from: '#2D1B69', to: '#5B21B6', accent: '#C4B5FD' },
  '클래식':      { from: '#1e3a5f', to: '#1D4ED8', accent: '#93C5FD' },
  '연극':        { from: '#7F1D1D', to: '#9F1239', accent: '#FCA5A5' },
  '뮤지컬':     { from: '#4C1D95', to: '#7C3AED', accent: '#DDD6FE' },
  '음악':        { from: '#1e3a5f', to: '#1D4ED8', accent: '#93C5FD' },
  '축제':        { from: '#6B1E00', to: '#B45309', accent: '#FDE68A' },
  '교육/체험':   { from: '#064E3B', to: '#0F766E', accent: '#6EE7B7' },
  '공연':        { from: '#1B4332', to: '#065F46', accent: '#86EFAC' },
  '청약':        { from: '#0F2027', to: '#203A43', accent: '#4ADE80' },
  '청약 가이드': { from: '#0F2027', to: '#203A43', accent: '#4ADE80' },
  'LH공고':      { from: '#0A2540', to: '#0E3460', accent: '#38BDF8' },
  '정책뉴스':    { from: '#0C2340', to: '#1E3A5F', accent: '#7DD3FC' },
  '무료 프로그램': { from: '#1B4332', to: '#065F46', accent: '#86EFAC' },
};

const DEFAULT_THEME = { from: '#1a1a2e', to: '#16213e', accent: '#A78BFA' };

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapText(text, maxLen = 17) {
  if (!text) return [''];
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.length > maxLen) {
      if (cur) { lines.push(cur); cur = ''; if (lines.length >= 3) break; }
      lines.push(word.substring(0, maxLen - 1) + '…');
      if (lines.length >= 3) break;
      continue;
    }
    const test = cur ? `${cur} ${word}` : word;
    if (test.length > maxLen && cur) {
      lines.push(cur);
      cur = word;
      if (lines.length >= 2) {
        // 3번째 줄은 나머지 텍스트를 모아 잘라냄
        const rest = words.slice(i).join(' ');
        lines.push(rest.length > maxLen + 1 ? rest.substring(0, maxLen - 1) + '…' : rest);
        break;
      }
    } else {
      cur = test;
    }
  }
  if (cur && lines.length < 3) lines.push(cur);
  return lines.slice(0, 3);
}

/**
 * @param {object} opts
 * @param {string} opts.title      - 메인 제목
 * @param {string} [opts.subtitle] - 부제목 (구이름, 설명 등)
 * @param {string} [opts.category] - 카테고리 (테마 색상 결정)
 * @param {string} [opts.district] - 자치구 (뱃지)
 * @param {boolean|null} [opts.isFree] - 무료/유료 뱃지
 * @returns {string} data:image/svg+xml;base64,...
 */
export function generateThumbnailSvg({ title, subtitle, category, district, isFree } = {}) {
  const theme = THEMES[category] || DEFAULT_THEME;
  const lines = wrapText(title || '', 17);
  const titleStartY = 200 + Math.max(0, (2 - lines.length) * 40);
  const lineSpacing = 88;

  const freeLabel = isFree === true ? '무료' : isFree === false ? '유료' : null;
  const freeBgColor = isFree ? '#10B981' : '#6B7280';

  const catText = esc(category || '서울로그');
  const catBadgeW = Math.max(catText.length * 15 + 44, 80);

  const subText = [district, subtitle].filter(Boolean).join(' · ');
  const subY = titleStartY + lines.length * lineSpacing + 28;

  const titleSvg = lines
    .map(
      (line, i) =>
        `<text x="60" y="${titleStartY + i * lineSpacing}"
      font-family="'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif"
      font-size="62" font-weight="800" fill="white" letter-spacing="-1.5">${esc(line)}</text>`
    )
    .join('\n  ');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${theme.from}"/>
      <stop offset="100%" stop-color="${theme.to}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1090" cy="85"  r="290" fill="white" fill-opacity="0.05"/>
  <circle cx="85"   cy="555" r="210" fill="white" fill-opacity="0.04"/>
  <circle cx="910"  cy="525" r="120" fill="${theme.accent}" fill-opacity="0.14"/>
  <rect x="0" y="0" width="8" height="630" fill="${theme.accent}"/>
  <rect x="40" y="48" width="${catBadgeW}" height="46" rx="23"
        fill="${theme.accent}" fill-opacity="0.22"/>
  <text x="62" y="80"
        font-family="'Apple SD Gothic Neo','Noto Sans KR',sans-serif"
        font-size="21" font-weight="600" fill="${theme.accent}">${catText}</text>
  ${freeLabel ? `<rect x="1082" y="48" width="78" height="46" rx="23" fill="${freeBgColor}" fill-opacity="0.92"/>
  <text x="1121" y="80"
        font-family="'Apple SD Gothic Neo','Noto Sans KR',sans-serif"
        font-size="21" font-weight="700" fill="white" text-anchor="middle">${esc(freeLabel)}</text>` : ''}
  ${titleSvg}
  ${subText ? `<text x="60" y="${subY}"
      font-family="'Apple SD Gothic Neo','Noto Sans KR',sans-serif"
      font-size="28" font-weight="400" fill="rgba(255,255,255,0.58)">${esc(subText)}</text>` : ''}
  <rect x="40" y="570" width="1120" height="1" fill="white" fill-opacity="0.18"/>
  <text x="1160" y="608"
        font-family="'Apple SD Gothic Neo','Noto Sans KR',sans-serif"
        font-size="22" font-weight="300" fill="rgba(255,255,255,0.42)"
        text-anchor="end">서울로그</text>
</svg>`;

  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
}
