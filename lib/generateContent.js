/**
 * Gemini API로 블로그 포스트 생성
 * 가격 정책: https://ai.google.dev/pricing
 */

const GEMINI_MODEL = 'gemini-3.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const RETRY_DELAYS = [5000, 15000, 30000];

// ─── 공통 유틸 ────────────────────────────────────────────────────────────────

function buildParkingSection(parkingLots) {
  if (!parkingLots?.length) return '';
  const items = parkingLots
    .map((p) => `  - <a href="${p.mapUrl}" target="_blank" rel="noopener">${p.name}</a> (${p.address}, 도보 ${p.distance})`)
    .join('\n');
  return `\n[실제 근처 주차장 — 🚗 주차 안내 섹션에 반드시 포함]\n${items}`;
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
      if (!e.message.includes('fetch failed') || attempt >= RETRY_DELAYS.length) throw e;
      const delay = RETRY_DELAYS[attempt];
      console.log(`[generateContent] 네트워크 오류 — ${delay / 1000}초 후 재시도...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

function parseResponse(rawText) {
  const cleaned = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {}

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }

  // JSON 잘림 복구
  const partial = match?.[0] ?? cleaned;
  const titleMatch = partial.match(/"title"\s*:\s*"([^"]+)"/);
  const htmlMatch  = partial.match(/"html"\s*:\s*"([\s\S]+)/);
  const labelsMatch = partial.match(/"labels"\s*:\s*(\[[^\]]*\])/);
  if (titleMatch && htmlMatch) {
    return {
      title: titleMatch[1],
      html: htmlMatch[1].replace(/"[\s\S]*$/, '').replace(/\\n/g, '\n'),
      labels: labelsMatch ? JSON.parse(labelsMatch[1]) : ['서울 볼거리', '서울 놀거리'],
    };
  }
  throw new Error(`Gemini 응답에서 JSON을 찾을 수 없습니다:\n${rawText.substring(0, 500)}`);
}

async function runGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 환경변수가 없습니다.');

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.85,
      maxOutputTokens: 8192,
    },
  };

  const res = await callGemini(apiKey, body);
  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error(`Gemini candidates 없음: ${JSON.stringify(data)}`);
  if (candidate.finishReason === 'SAFETY') throw new Error('Gemini 안전 필터에 차단됨');
  const rawText = candidate.content?.parts?.[0]?.text;
  if (!rawText) throw new Error(`Gemini 텍스트 없음: ${JSON.stringify(candidate)}`);
  return parseResponse(rawText);
}

// ─── 1. 문화행사 포스트 ────────────────────────────────────────────────────────

function buildEventPrompt(event, scrapedText, parkingLots) {
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });
  const hasExtra = !!scrapedText;
  const lengthGuide = hasExtra
    ? '1800~2200자. "행사 소개" 섹션을 5~7문장으로 충분히 확장.'
    : '1000~1200자. 정보가 제한적이므로 알맹이만 간결하게. 억지로 채우지 말 것.';

  const extraBlock = scrapedText ? `\n[공식 페이지 수집 정보]\n${scrapedText}` : '';
  const parkingBlock = buildParkingSection(parkingLots);

  // 선택적 필드 (값 있을 때만 포함)
  const optionalFields = [
    event.district      && `자치구: ${event.district}`,
    event.useFee        && `입장료: ${event.useFee}`,
    event.performTime   && `공연 시작 시간: ${event.performTime}`,
    event.performers    && `출연자: ${event.performers}`,
    event.inquiry       && `문의: ${event.inquiry}`,
    event.etcDesc       && `기타 안내: ${event.etcDesc}`,
    event.homepageUrl   && `홈페이지: ${event.homepageUrl}`,
  ].filter(Boolean).join('\n');

  return `당신은 서울 나들이 정보를 소개하는 블로그 에디터입니다.
아래 행사 하나에 대해 실제로 다녀온 사람이 쓴 것처럼 생생하고 실용적인 블로그 포스트를 작성해주세요.
오늘 날짜: ${today}

[HTML 구조 — 반드시 이 순서대로]

1. <p> 도입부 </p>
   - 이 행사가 지금 왜 가볼 만한지 2~3문장. 계절감·분위기 살리기. 낚시 금지.

2. <h2>✨ 이런 분께 딱!</h2>
   <ul> 해당하는 것만 3~4개 — 각 항목: [이유 1문장] + [구체적 예시 1문장]
   - <li>👨‍👩‍👧 아이와 함께: ...</li>
   - <li>💑 데이트 코스: ...</li>
   - <li>🚶 혼자 방문: ...</li>
   - <li>👴 어르신과 함께: ...</li>
   - <li>🎓 학생·청소년: ...</li>
   </ul>

3. <h2>🎪 행사 소개</h2>
   - ${hasExtra ? '공식 페이지 정보를 최대한 활용해 프로그램·볼거리·체험거리를 5~7문장으로 상세히 서술.' : '3~4문장으로 핵심만. 모르는 내용은 지어내지 말고 "공식 페이지 참고"로 처리.'}

4. <h2>📋 기본 정보</h2>
   <ul>
   <li><strong>기간:</strong> ...</li>
   <li><strong>장소:</strong> ...</li>
   <li><strong>운영 시간:</strong> [알면 기재, 모르면 "공식 페이지 확인"]</li>
   <li><strong>입장료:</strong> [입장료 필드 활용, 없으면 무료/유료만 표기]</li>
   <li><strong>예약:</strong> [방법 및 링크]</li>
   <li><strong>문의:</strong> [inquiry 필드, 없으면 생략]</li>
   </ul>

5. <h2>🚇 교통 안내</h2>
   - 장소 기반으로 가장 가까운 지하철역·호선·출구 번호 안내.
   - 출구에서 도보 소요시간: 확실히 알 때만 "약 X분"으로 표기. 모르면 "도보 이동"으로만 표현. 절대 지어내지 말 것.
   - 버스 환승 팁 있으면 한 줄 추가. 장소 불명확 시 "공식 페이지 지도 참고".

6. <h2>🚗 주차 안내</h2>
   - 주차장 데이터 있으면 반드시 포함 (링크 포함).
   - 데이터 없으면: 해당 장소의 주차 가능 여부 (모르면 "현장 확인 권장").
   - 마지막에 "가능하면 대중교통 이용을 권장해요." 한 줄.

7. <p><a href="[orgLink]" target="_blank" rel="noopener">[행사명] 공식 페이지 바로가기 →</a></p>
   (orgLink 없고 homepageUrl 있으면 그것 사용. 둘 다 없으면 생략.)

[작성 규칙]
- 분량: ${lengthGuide}
- 어투: 20~30대 구어체, "-요" 체. "~입니다" 문어체 금지.
- HTML 태그만: h2, p, ul, li, strong, a. 다른 태그 금지.
- 없는 정보 절대 지어내지 말 것.
- SEO title: "[행사명] [장소/지역구] [연도/기간]" 포함.
- labels 규칙 — 실제 검색어 형태로 5~7개:
  * 문장형·조합형 우선: "[구이름] 무료 주말", "[대상] 서울 나들이", "이번 주 서울 무료"
  * 반드시 포함: "서울 볼거리", "서울 놀거리", "서울 가볼만한곳" 중 2개 이상
  * 카테고리 단어 단독 사용 금지 (예: "전시" ❌ → "서울 무료 전시" ✅)

[행사 정보]
제목: ${event.title}
분류: ${event.category}
장소: ${event.place}
기간: ${event.startDate} ~ ${event.endDate}
대상: ${event.targetAudience || '누구나'}
무료여부: ${event.isFree ? '무료' : '유료'}
설명: ${event.description || '(없음)'}
공식 링크: ${event.orgLink || '없음'}
${optionalFields}${extraBlock}${parkingBlock}

응답은 반드시 아래 JSON만 출력:
{"title":"...","html":"...","labels":["..."]}`;
}

export async function generatePostForEvent(event, scrapedText = null, parkingLots = []) {
  console.log(`[generateContent] "${event.title}" 포스트 생성 중...`);
  const post = await runGemini(buildEventPrompt(event, scrapedText, parkingLots));
  if (!post.title || !post.html || !Array.isArray(post.labels)) {
    throw new Error(`필수 필드 누락: ${JSON.stringify(post)}`);
  }
  console.log(`[generateContent] 완료: "${post.title}"`);
  return post;
}

// ─── 2. 구별 무료공간 모음 포스트 ─────────────────────────────────────────────

function buildFacilityPrompt(district, facilities, parkingMap) {
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  const facilityList = facilities.map((f, i) => {
    const parking = parkingMap[i]?.slice(0, 2).map(p => `${p.name}(${p.distance})`).join(', ') || '현장 확인';
    return `[${i + 1}] ${f.name}
  장소: ${f.place}
  대상: ${f.targetAudience || '누구나'}
  기간: ${f.startDate} ~ ${f.endDate}
  운영시간: ${f.operatingTime || '공식 페이지 확인'}
  전화: ${f.phone || '-'}
  예약: ${f.bookingUrl}
  근처 주차: ${parking}`;
  }).join('\n\n');

  return `당신은 서울 무료 문화공간을 소개하는 블로그 에디터입니다.
오늘 날짜: ${today}

${district}에서 현재 무료로 이용 가능한 문화 프로그램/공간을 소개하는 블로그 포스트를 작성해주세요.

[HTML 구조]
1. <p> 도입부 </p> — "${district}에서 이번에 이런 무료 프로그램이 있다"는 내용, 2~3문장
2. <h2>📍 ${district} 이번 주 무료 문화 프로그램</h2>
   각 시설마다 <h3>[번호]. 시설/프로그램명</h3> + <p>소개 2~3문장</p> + <ul>기본정보·예약링크·주차</ul>
3. <p> 마무리 </p> — 가볍게 1~2문장

[작성 규칙]
- 분량: 1500~2000자
- 어투: 친근한 구어체 "-요" 체
- HTML 태그만: h2, h3, p, ul, li, strong, a
- 없는 정보는 "현장 확인" 또는 "공식 페이지 참고"로 처리
- SEO title: "${district} 무료 문화 프로그램 [연도/월] 모음"
- labels — 실제 검색어 5~7개:
  * "${district} 무료 체험", "${district} 주말 나들이", "서울 무료 문화 프로그램"
  * "서울 볼거리", "서울 놀거리", "서울 가볼만한곳" 중 2개 이상 포함

[시설 목록]
${facilityList}

응답: {"title":"...","html":"...","labels":["..."]}`;
}

export async function generatePostForFacilities(district, facilities, parkingMap = {}) {
  console.log(`[generateContent] "${district} 무료공간 모음" 포스트 생성 중...`);
  const post = await runGemini(buildFacilityPrompt(district, facilities, parkingMap));
  if (!post.title || !post.html || !Array.isArray(post.labels)) {
    throw new Error(`필수 필드 누락: ${JSON.stringify(post)}`);
  }
  console.log(`[generateContent] 완료: "${post.title}"`);
  return post;
}
