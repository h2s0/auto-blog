/**
 * Gemini API (gemini-2.5-flash, 무료 티어)로 블로그 원고 생성
 * 가격 정책: https://ai.google.dev/pricing
 */

const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function buildPrompt(events) {
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const eventList = events
    .slice(0, 15) // 너무 많으면 토큰 낭비 방지
    .map(
      (e, i) =>
        `[${i + 1}] 제목: ${e.title}
  분류: ${e.category}
  장소: ${e.place}
  기간: ${e.startDate} ~ ${e.endDate}
  대상: ${e.targetAudience || '전 연령'}
  무료여부: ${e.isFree ? '무료' : '유료'}
  설명: ${e.description || '(없음)'}
  링크: ${e.orgLink || ''}`
    )
    .join('\n\n');

  return `당신은 서울 문화생활을 소개하는 블로그 에디터입니다.
오늘(${today}) 서울에서 진행 중인 문화행사 정보를 바탕으로 블로그 포스트를 작성해주세요.

규칙:
- 단순 나열 금지. 독자가 실제로 가고 싶어지도록 생동감 있게 재구성할 것
- 제목은 클릭을 유도하되 낚시성 제목 금지
- HTML 형식으로 작성 (h2, p, ul, li, strong, a 태그 사용 가능)
- 행사는 카테고리별로 묶어서 소개
- 무료 행사는 특별히 강조
- labels 배열: 관련 태그 3~6개 (예: "서울", "문화행사", "전시", "무료")
- 응답은 반드시 아래 JSON 스키마만 출력:

{
  "title": "블로그 포스트 제목",
  "html": "본문 HTML 문자열",
  "labels": ["태그1", "태그2"]
}

오늘의 행사 목록:
${eventList}`;
}

const RETRY_DELAYS = [5000, 15000, 30000]; // 5초, 15초, 30초

async function callGemini(apiKey, body) {
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) return res;

    const errText = await res.text();

    // 503/429는 일시적 과부하 — 재시도
    if ((res.status === 503 || res.status === 429) && attempt < RETRY_DELAYS.length) {
      const delay = RETRY_DELAYS[attempt];
      console.log(`[generateContent] Gemini ${res.status} — ${delay / 1000}초 후 재시도 (${attempt + 1}/${RETRY_DELAYS.length})...`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    throw new Error(`Gemini API HTTP error ${res.status}: ${errText}`);
  }
}

export async function generateBlogPost(events) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 환경변수가 없습니다.');

  if (events.length === 0) {
    throw new Error('오늘 진행 중인 행사가 없어 포스트를 생성할 수 없습니다.');
  }

  console.log(`[generateContent] Gemini ${GEMINI_MODEL}로 블로그 원고 생성 중...`);

  const body = {
    contents: [{ parts: [{ text: buildPrompt(events) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.9,
      maxOutputTokens: 8192,
    },
  };

  const res = await callGemini(apiKey, body);


  const data = await res.json();

  // 응답 구조 방어 처리
  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new Error(`Gemini 응답에 candidates가 없습니다: ${JSON.stringify(data)}`);
  }

  if (candidate.finishReason === 'SAFETY') {
    throw new Error('Gemini가 안전 필터로 응답을 차단했습니다.');
  }

  const rawText = candidate.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error(`Gemini 응답에서 텍스트를 찾을 수 없습니다: ${JSON.stringify(candidate)}`);
  }

  let post;
  try {
    // 마크다운 코드 펜스 제거 후 파싱 시도
    const cleaned = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    post = JSON.parse(cleaned);
  } catch {
    // JSON 블록만 추출해서 재시도
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Gemini 응답에서 JSON을 찾을 수 없습니다:\n${rawText.substring(0, 500)}`);
    try {
      post = JSON.parse(match[0]);
    } catch {
      throw new Error(`Gemini 응답이 유효한 JSON이 아닙니다:\n${rawText.substring(0, 500)}`);
    }
  }

  if (!post.title || !post.html || !Array.isArray(post.labels)) {
    throw new Error(`Gemini JSON 응답에 필수 필드(title, html, labels)가 없습니다: ${JSON.stringify(post)}`);
  }

  console.log(`[generateContent] 원고 생성 완료: "${post.title}"`);
  return post;
}
