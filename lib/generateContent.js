/**
 * Gemini API (gemini-3.6-flash, 무료 티어)로 행사 1개당 상세 블로그 포스트 생성
 * 가격 정책: https://ai.google.dev/pricing
 */

const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const RETRY_DELAYS = [5000, 15000, 30000];

function buildPrompt(event, scrapedText) {
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  const extraInfo = scrapedText
    ? `\n[공식 페이지에서 수집한 추가 정보]\n${scrapedText}`
    : '';

  return `당신은 서울 문화생활을 소개하는 블로그 에디터입니다.
아래 행사 하나에 대한 상세 블로그 포스트를 작성해주세요. 오늘 날짜는 ${today}입니다.

[작성 규칙]
- 분량: 본문 700~1000자 (한국어 기준)
- 어투: 친근하고 자연스러운 구어체. AI가 쓴 것처럼 딱딱하지 않게.
- 구성 순서:
  1. 도입부: 이 행사가 왜 지금 가볼 만한지 1~2문장 (클릭 유도, 낚시 금지)
  2. 행사 소개: 어떤 행사인지, 어떤 프로그램이 있는지 구체적으로
  3. 장소 & 교통: 정확한 장소명, 가장 가까운 지하철역과 출구 번호
  4. 일정 & 가격: 운영 기간, 시간, 입장료/예약 방법
  5. 에디터 한마디: "이런 분께 특히 추천합니다" 1~2문장
- HTML 태그만 사용 (h2, h3, p, ul, li, strong, a)
- a 태그로 공식 링크 반드시 포함 (target="_blank")
- SEO: 제목과 본문에 "[행사명] [장소] [날짜/기간]" 키워드 자연스럽게 포함
- labels: 검색에 유리한 태그 4~6개 (행사명 핵심어, 장소구, "무료" 또는 "서울 전시" 등)
- 없는 정보는 절대 지어내지 말 것. 모르면 "공식 페이지에서 확인하세요"로 처리.

[행사 정보]
제목: ${event.title}
분류: ${event.category}
장소: ${event.place}
기간: ${event.startDate} ~ ${event.endDate}
대상: ${event.targetAudience || '누구나'}
무료여부: ${event.isFree ? '무료' : '유료'}
설명: ${event.description || '(없음)'}
공식 링크: ${event.orgLink || '없음'}
${extraInfo}

응답은 반드시 아래 JSON만 출력:
{
  "title": "SEO 최적화된 포스트 제목 (행사명+장소+날짜 포함)",
  "html": "본문 HTML",
  "labels": ["태그1", "태그2"]
}`;
}

async function callGemini(apiKey, body) {
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) return res;

      const errText = await res.text();
      if ((res.status === 503 || res.status === 429) && attempt < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[attempt];
        console.log(`[generateContent] Gemini ${res.status} — ${delay / 1000}초 후 재시도 (${attempt + 1}/${RETRY_DELAYS.length})...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw new Error(`Gemini API HTTP error ${res.status}: ${errText}`);
    } catch (e) {
      // 네트워크 레벨 오류 재시도
      if (attempt < RETRY_DELAYS.length && e.message !== 'fetch failed') throw e;
      if (attempt < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[attempt];
        console.log(`[generateContent] 네트워크 오류 — ${delay / 1000}초 후 재시도 (${attempt + 1}/${RETRY_DELAYS.length})...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw e;
      }
    }
  }
}

function parseResponse(rawText) {
  try {
    const cleaned = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    return JSON.parse(cleaned);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Gemini 응답에서 JSON을 찾을 수 없습니다:\n${rawText.substring(0, 500)}`);
    return JSON.parse(match[0]);
  }
}

export async function generatePostForEvent(event, scrapedText = null) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 환경변수가 없습니다.');

  console.log(`[generateContent] "${event.title}" 포스트 생성 중...`);

  const body = {
    contents: [{ parts: [{ text: buildPrompt(event, scrapedText) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.85,
      maxOutputTokens: 4096,
    },
  };

  const res = await callGemini(apiKey, body);
  const data = await res.json();

  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error(`Gemini 응답에 candidates가 없습니다: ${JSON.stringify(data)}`);
  if (candidate.finishReason === 'SAFETY') throw new Error('Gemini 안전 필터에 의해 차단됐습니다.');

  const rawText = candidate.content?.parts?.[0]?.text;
  if (!rawText) throw new Error(`Gemini 응답에서 텍스트를 찾을 수 없습니다: ${JSON.stringify(candidate)}`);

  const post = parseResponse(rawText);
  if (!post.title || !post.html || !Array.isArray(post.labels)) {
    throw new Error(`Gemini JSON에 필수 필드가 없습니다: ${JSON.stringify(post)}`);
  }

  console.log(`[generateContent] 완료: "${post.title}"`);
  return post;
}
