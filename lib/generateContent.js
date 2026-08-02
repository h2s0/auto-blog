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
    ? `\n[공식 페이지 수집 정보]\n${scrapedText}`
    : '';

  return `당신은 서울 나들이 정보를 소개하는 블로그 에디터입니다.
아래 행사 하나에 대해 실제로 다녀온 사람이 쓴 것처럼 생생하고 실용적인 블로그 포스트를 작성해주세요.
오늘 날짜는 ${today}입니다.

[HTML 구조 — 반드시 이 순서대로]

1. <p> 도입부 </p>
   - 이 행사가 지금 왜 가볼 만한지 2~3문장. 계절감·분위기 살리기. 낚시성 금지.

2. <h2>✨ 이런 분께 딱!</h2>
   <ul> 아래 중 해당하는 것만 골라 3~4개 작성 (없는 것 억지로 넣지 말 것)
   - <li>👨‍👩‍👧 아이와 함께: [이유 한 줄]</li>
   - <li>💑 데이트 코스: [이유 한 줄]</li>
   - <li>🚶 혼자 방문: [이유 한 줄]</li>
   - <li>👴 어르신과 함께: [이유 한 줄]</li>
   - <li>🎓 학생·청소년: [이유 한 줄]</li>
   </ul>

3. <h2>🎪 행사 소개</h2>
   - 어떤 행사인지, 볼거리·체험거리·프로그램 구체적으로 서술 (3~5문장)
   - 공식 페이지 정보 있으면 최대한 활용
   - 모르는 세부 내용은 지어내지 말고 "자세한 프로그램은 공식 페이지 참고"로 처리

4. <h2>📋 기본 정보</h2>
   <ul>
   <li><strong>기간:</strong> [날짜 범위]</li>
   <li><strong>장소:</strong> [장소명]</li>
   <li><strong>운영 시간:</strong> [알면 기재, 모르면 "공식 페이지 확인"]</li>
   <li><strong>입장료:</strong> [무료/가격, 모르면 "공식 페이지 확인"]</li>
   <li><strong>예약:</strong> [예약 필요 여부 및 방법, 링크 포함]</li>
   </ul>

5. <h2>🚇 교통 안내</h2>
   - 장소명을 기반으로 가장 가까운 지하철역과 호선·출구 번호 안내
   - 버스 환승 팁 있으면 한 줄 추가
   - 장소가 불명확하면 "정확한 위치는 공식 페이지 지도 참고"

6. <h2>🚗 주차 안내</h2>
   - 해당 장소의 주차 가능 여부 (알면 구체적으로, 모르면 "주차 가능 여부는 현장 확인 권장")
   - 근처 공영주차장 팁 있으면 추가
   - 대중교통 이용 권장 문구 한 줄

7. <p><a href="[orgLink]" target="_blank" rel="noopener">[행사명] 공식 페이지 바로가기 →</a></p>
   (orgLink 없으면 이 항목 생략)

[작성 규칙]
- 분량: 본문 1000~1400자
- 어투: 20~30대가 쓰는 자연스러운 구어체. "-요" 체. "~입니다" 딱딱한 문어체 금지.
- HTML 태그만 사용 (h2, p, ul, li, strong, a). 다른 태그 사용 금지.
- 없는 정보 절대 지어내지 말 것.
- SEO: 포스트 제목에 "[행사명] [장소/지역] [연도/기간]" 포함. 본문에 자연스럽게 키워드 배치.
- labels: 검색 유리한 태그 5~7개. 예: "서울 무료 공연", "강동구 축제", "가족 나들이", "2026 서울 전시" 등 실제 검색어 형태로.

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
  "title": "SEO 최적화된 포스트 제목",
  "html": "본문 HTML",
  "labels": ["태그1", "태그2", "태그3"]
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
      maxOutputTokens: 8192,
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
