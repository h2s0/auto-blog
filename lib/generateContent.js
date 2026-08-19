/**
 * Gemini API로 블로그 포스트 생성
 * 가격 정책: https://ai.google.dev/pricing
 */

const GEMINI_MODEL = 'gemini-3.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const RETRY_DELAYS = [10000, 30000, 60000, 90000];

// ─── 공통 유틸 ────────────────────────────────────────────────────────────────

function buildParkingSection(parkingLots) {
  if (!parkingLots?.length) return '';
  const items = parkingLots
    .map((p) => `  - <a href="${p.mapUrl}" target="_blank" rel="noopener">${p.name}</a> (${p.address}, 도보 ${p.distance}, 요금: ${p.fee})`)
    .join('\n');
  return `\n[실제 근처 주차장 — 🚗 주차 안내 섹션에 아래 정보 그대로 포함]\n${items}`;
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

function shortenPrompt(prompt) {
  return prompt
    .replace(/1800~2200자/, '1000~1300자')
    .replace(/1500~2000자/, '900~1200자')
    .replace(/1200~1500자/, '800~1000자')
    .replace(/1000~1500자/, '700~900자')
    .replace(/1000~1200자/, '700~900자')
    .replace(/800~1000자[^)]*/, '600~750자')
    .replace(/5~7문장/g, '3~4문장');
}

function isHtmlComplete(html) {
  const trimmed = html.trimEnd();
  // 닫힌 블록 태그로 끝나면 완전한 것으로 간주
  return /(<\/p>|<\/ul>|<\/li>|<\/h2>|<\/h3>)\s*$/.test(trimmed);
}

async function runGemini(prompt, maxTokens = 16384) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 환경변수가 없습니다.');

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.85,
      maxOutputTokens: maxTokens,
    },
  };

  const res = await callGemini(apiKey, body);
  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error(`Gemini candidates 없음: ${JSON.stringify(data)}`);
  if (candidate.finishReason === 'SAFETY') throw new Error('Gemini 안전 필터에 차단됨');

  // 토큰 초과로 잘린 경우 → 짧은 버전으로 재시도
  if (candidate.finishReason === 'MAX_TOKENS') {
    if (maxTokens > 8192) {
      console.log('[generateContent] 응답 잘림(MAX_TOKENS) — 짧은 버전으로 재시도...');
      return runGemini(shortenPrompt(prompt), 8192);
    }
    console.log('[generateContent] 재시도에서도 잘림 — 부분 내용으로 진행');
  }

  const rawText = candidate.content?.parts?.[0]?.text;
  if (!rawText) throw new Error(`Gemini 텍스트 없음: ${JSON.stringify(candidate)}`);

  const post = parseResponse(rawText);

  // HTML이 중간에 잘렸으면 에러로 처리 (발행 막기)
  if (post.html && !isHtmlComplete(post.html)) {
    if (maxTokens > 8192) {
      console.log('[generateContent] HTML 불완전 감지 — 짧은 버전으로 재시도...');
      return runGemini(shortenPrompt(prompt), 8192);
    }
    throw new Error('HTML이 완전하지 않아 발행을 중단합니다. (토큰 초과)');
  }

  return post;
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

2. <p>📌 <strong>한눈에 보기</strong> — 장소 · 기간 · 입장료 3가지만 딱 한 줄씩 정리. 독자가 스크롤 없이 핵심을 파악하게.</p>

3. <h2>✨ 이런 분께 딱!</h2>
   <ul> 해당하는 것만 3~4개 — 각 항목: [이유 1문장] + [구체적 예시 1문장]
   - <li>👨‍👩‍👧 아이와 함께: ...</li>
   - <li>💑 데이트 코스: ...</li>
   - <li>🚶 혼자 방문: ...</li>
   - <li>👴 어르신과 함께: ...</li>
   - <li>🎓 학생·청소년: ...</li>
   </ul>

4. <h2>🎪 행사 소개</h2>
   - ${hasExtra ? '공식 페이지 정보를 최대한 활용해 프로그램·볼거리·체험거리를 5~7문장으로 상세히 서술.' : '3~4문장으로 핵심만. 모르는 내용은 지어내지 말고 "공식 페이지 참고"로 처리.'}
   - 행사명·장소명·구이름 키워드를 본문에 자연스럽게 3~4회 녹여서 반복.
   - 준비물·복장·취소 정책 등 실용 정보가 있으면 이 섹션 마지막에 자연스럽게 한두 문장으로 녹여서 언급.

5. <h2>📋 기본 정보</h2>
   <ul>
   <li><strong>기간:</strong> ...</li>
   <li><strong>장소:</strong> ...</li>
   <li><strong>운영 시간:</strong> [알면 기재, 모르면 "공식 페이지 확인"]</li>
   <li><strong>입장료:</strong> [입장료 필드 활용, 없으면 무료/유료만 표기]</li>
   <li><strong>예약:</strong> [방법 설명] <a href="[예약URL]" target="_blank" rel="noopener">→ 예약 바로가기</a> (orgLink 또는 bookingUrl 사용. 링크 없으면 전화·현장 접수라고만 표기)</li>
   <li><strong>문의:</strong> [inquiry 필드, 없으면 생략]</li>
   </ul>

6. <h2>🚇 교통 안내</h2>
   - 형식: "지하철 [N]호선 [역명]역 [번호]번 출구에서 도보로 약 [X~Y]분 거리예요."
   - 역·출구·도보시간은 네이버지도·카카오맵 기준 일반적인 수치로 범위(약 X~Y분)로 표기. 모를 때만 "도보 이동" 표현.
   - 역에서 10분 이상 걸리면 버스 환승 팁 추가: "[역명] 인근에서 버스 환승 후 '[정류장명]' 정류장 하차"
   - 버스도 모르면 생략. 정말 장소 자체가 불명확할 때만 "공식 페이지 지도 참고"로 처리.

7. <h2>🚗 주차 안내</h2>
   - 주차장 데이터 있으면 <ul>로 각 주차장 표시: <li>이름(링크) — 도보 거리, 요금</li> 형식.
   - 요금이 "현장 확인"이면 그대로 표기. "가급적 대중교통" 같은 뻔한 멘트 금지.
   - 데이터 없으면: 해당 장소 주차 가능 여부만 간단히.
   - 마지막에 "혼잡할 수 있으니 대중교통도 고려해보세요." 한 줄.

8. <p><a href="[orgLink]" target="_blank" rel="noopener">[행사명] 공식 페이지 바로가기 →</a></p>
   (orgLink 없고 homepageUrl 있으면 그것 사용. 둘 다 없으면 생략.)

[작성 규칙]
- 분량: ${lengthGuide}
- 어투: 20~30대 구어체, "-요" 체. "~입니다" 문어체 금지. AI 티 나는 뻔한 문장 금지.
- 줄바꿈: <p> 태그 하나에 1~2문장만. 문장이 3개 이상이면 반드시 <p>를 나눌 것. 모바일 가독성 최우선.
- HTML 태그만: h2, p, ul, li, strong, a. 다른 태그 금지.
- 없는 정보 절대 지어내지 말 것.
- title: 아무 값이나 넣어도 됨 (코드에서 덮어씀)
- labels 규칙 — 실제 검색어 형태로 6~8개:
  * 구이름은 반드시 단독 태그로 분리 (예: "마포구" 단독. 절대로 "마포구 데이트" 처럼 합치기 금지)
  * 활동·성격 키워드는 별도 태그로 (예: "데이트", "나들이", "주말 나들이", "이번 주 서울 무료")
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
  if (!post.html || !Array.isArray(post.labels)) {
    throw new Error(`필수 필드 누락: ${JSON.stringify(post)}`);
  }

  // 제목 형식 강제 적용 (Gemini 생성 제목 덮어쓰기)
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const freeText = event.isFree ? '무료' : '유료';
  const district = event.district ? `${event.district} ` : '';
  const category = event.category ? ` ${event.category}` : '';
  post.title = `${year}년 ${month}월 서울 ${freeText} 행사 - ${district}${event.place} ${event.title}${category} 정보 예약 교통 주차장 정보`;

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
- 분량: 1000~1300자
- 어투: 20~30대 구어체 "-요" 체. "~입니다" 문어체 금지. AI 티 나는 뻔한 문장 금지.
- 줄바꿈: <p> 태그 하나에 1~2문장만. 문장이 3개 이상이면 반드시 <p>를 나눌 것. 모바일 가독성 최우선.
- HTML 태그만: h2, h3, p, ul, li, strong, a
- 없는 정보는 "현장 확인" 또는 "공식 페이지 참고"로 처리
- SEO title: 시설이 2개 이상이면 "${district} 무료 문화 프로그램 [연도/월] 모음", 1개면 "[프로그램명] ${district} [연도/월] 무료 체험 안내" 형식 사용. 절대 1개짜리에 "모음" 사용 금지.
- labels — 실제 검색어 형태로 6~8개:
  * 구이름은 반드시 단독 태그로 분리 (예: "${district}" 단독. 절대로 "${district} 데이트" 처럼 합치기 금지)
  * 활동·성격 키워드는 별도 태그로 (예: "데이트", "나들이", "무료 체험", "주말 나들이")
  * 반드시 포함: "${district}" 단독, "서울 무료 문화 프로그램"
  * "서울 볼거리", "서울 놀거리", "서울 가볼만한곳" 중 2개 이상 포함
  * 카테고리 단어 단독 사용 금지 (예: "전시" ❌ → "서울 무료 전시" ✅)

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

// ─── 3. 서울 시민 복지·생활 정책 포스트 ─────────────────────────────────────

function buildPolicyNewsPrompt(newsItems) {
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  const newsList = newsItems.map((n, i) => `[${i + 1}] ${n.title}
  부처: ${n.ministry}
  내용: ${n.subtitle || n.summary.substring(0, 300)}
  원문: ${n.url}`).join('\n\n');

  return `당신은 서울 시민의 복지·생활 혜택을 쉽게 안내하는 블로그 에디터입니다.
오늘 날짜: ${today}

아래 정부 정책 정보를 "나는 해당되나? 어떻게 받나?"에 집중해서 실용적으로 정리해주세요.
어려운 행정 용어는 모두 일상 언어로 바꿔 쓰세요.

[HTML 구조]
1. <p> 도입부 </p> — 이 글에서 다루는 혜택/정보를 1~2문장으로 소개

2. 각 정책마다:
   <h2>💡 [정책명을 쉬운 말로] — 누가 받나요?</h2>
   <ul>
     <li><strong>대상:</strong> 어떤 사람이 받을 수 있는지 한 줄</li>
     <li><strong>혜택:</strong> 구체적으로 얼마/무엇을 받나</li>
     <li><strong>신청:</strong> 어디서, 어떻게 신청하는지</li>
   </ul>
   <p><a href="[원문URL]" target="_blank" rel="noopener">자세히 보기 →</a></p>

3. <p> 마무리 </p> — "놓치지 말고 확인하세요" 류 1문장

[작성 규칙]
- 분량: 800~1200자
- 어투: 20~40대 구어체 "-요" 체. "~입니다" 금지.
- 없는 정보(금액·날짜 등)는 지어내지 말고 "원문 확인 필요"로 처리
- HTML 태그만: h2, p, ul, li, strong, a
- title: "2026년 [월]월 서울 시민 [주요혜택키워드] 정책 정리" 형식
- labels — 실제 검색어 6~8개:
  * "서울 복지 혜택", "정부 지원금", "서울 시민 혜택" 반드시 포함
  * 기사 주제별 구체적 검색어 (예: "청년 주거 지원", "출산 지원금", "의료비 지원")

[정책 정보]
${newsList}

응답: {"title":"...","html":"...","labels":["..."]}`;
}

export async function generatePostForPolicyNews(newsItems) {
  console.log(`[generateContent] 정책뉴스 모음 포스트 생성 중...`);
  const post = await runGemini(buildPolicyNewsPrompt(newsItems));
  if (!post.title || !post.html || !Array.isArray(post.labels)) {
    throw new Error(`필수 필드 누락: ${JSON.stringify(post)}`);
  }
  console.log(`[generateContent] 완료: "${post.title}"`);
  return post;
}

// ─── 4. 청약 가이드 에버그린 포스트 ───────────────────────────────────────────

function buildCheongyakGuidePrompt(topic) {
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  const callout = `<p style="background:#f0f9ff;border-left:4px solid #0ea5e9;padding:12px 16px;border-radius:0 8px 8px 0;margin:0.5em 0 1.2em;">⏱️ <strong>시간 없으면 맨 아래 '핵심 정리'만 보세요!</strong></p>`;

  return `당신은 부동산 청약 정보를 쉽게 풀어주는 블로그 에디터입니다.
오늘 날짜: ${today}

"${topic}"에 대해 청약을 처음 접하는 20~30대가 빠르게 파악할 수 있는 짧고 실용적인 블로그 포스트를 작성해주세요.

[HTML 구조 — 반드시 이 순서대로]

1. 다음 callout HTML을 그대로 첫 줄에 삽입 (수정 금지):
${callout}

2. <p> 도입부 </p> — 1~2문장. 왜 알아야 하는지만.

3. <h2>📌 한눈에 보기</h2>
   <ul> 핵심 포인트 3개 이내. 한 줄씩. </ul>

4. <h2>✅ ${topic} 핵심 내용</h2>
   <p> 소주제 1~2개만. 각 소주제는 <h3>로 구분. 예시 1~2문장 포함. 길게 쓰지 말 것. </p>

5. <h2>⚠️ 이것만 조심!</h2>
   <ul> 자주 하는 실수 2~3개. 한 줄씩. </ul>

6. 다음 구조로 핵심 정리 박스 작성 (style 그대로 사용):
   <h2>🗂️ 핵심 정리</h2>
   <ul>
     <li><strong>키워드:</strong> 한 줄 설명</li>
     ... (3~5개)
   </ul>
   <p style="background:#f8fafc;border:1px solid #e2e8f0;padding:12px 16px;border-radius:8px;font-size:0.9em;">📋 수치·조건은 변동될 수 있으니 <a href="https://applyhome.go.kr" target="_blank" rel="noopener">청약홈(applyhome.go.kr)</a>에서 반드시 확인하세요.</p>

[작성 규칙]
- 분량: 전체 800~1000자 (짧을수록 좋음. 절대 1000자 초과 금지)
- 어투: 20~30대 구어체 "-요" 체. "~입니다" 문어체 금지.
- 줄바꿈: <p> 태그 하나에 1~2문장만.
- HTML 태그: h2, h3, p, ul, li, strong, a 만 사용. style 속성은 위 지정된 것만.
- 없는 정보 지어내지 말 것.
- labels — 실제 검색어 형태로 6~8개:
  * 반드시 포함: "청약 방법", "청약 자격", "서울 청약", "부동산 청약" 중 2개 이상
  * 주제 관련 구체적 검색어 포함
  * "청약 총정리", "청약 가이드" 형태도 포함

응답은 반드시 아래 JSON만 출력:
{"title":"...","html":"...","labels":["..."]}`;
}

export async function generatePostForCheongyakGuide(topic) {
  console.log(`[generateContent] 청약가이드 "${topic}" 포스트 생성 중...`);
  const post = await runGemini(buildCheongyakGuidePrompt(topic));
  if (!post.html || !Array.isArray(post.labels)) {
    throw new Error(`필수 필드 누락: ${JSON.stringify(post)}`);
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  post.title = `${year}년 ${month}월 ${topic} 완전 정리 - 청약 가이드`;

  console.log(`[generateContent] 완료: "${post.title}"`);
  return post;
}

// ─── 5. LH 청약 공고 모음 포스트 ──────────────────────────────────────────────

function buildLhNoticePrompt(notices) {
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  const noticeList = notices.map((n, i) => `[${i + 1}] ${n.title}
  유형: ${n.type || '-'}
  지역: ${n.area || '-'}
  접수기간: ${n.startDate || '-'} ~ ${n.endDate || '-'}
  기관: ${n.org || 'LH'}
  상세: ${n.detailUrl || 'https://www.lh.or.kr'}`).join('\n\n');

  return `당신은 LH·SH 청약 공고를 정리해주는 블로그 에디터입니다.
오늘 날짜: ${today}

아래 LH·SH 청약 공고들을 서울 시민 입장에서 쉽고 실용적으로 정리한 블로그 포스트를 작성해주세요.

[HTML 구조]
1. <p> 도입부 </p> — 이번 공고들이 어떤 유형인지 2~3문장 요약
2. 각 공고마다:
   <h2>[번호]. 공고명 (유형)</h2>
   <p> 이 공고가 어떤 사람에게 맞는지 1~2문장 </p>
   <ul>
     <li><strong>접수기간:</strong> ...</li>
     <li><strong>공급유형:</strong> ...</li>
     <li><strong>지역:</strong> ...</li>
     <li><strong>자세히 보기:</strong> <a href="[상세URL]" target="_blank" rel="noopener">LH 공고 바로가기 →</a></li>
   </ul>
3. <p> 마무리 </p> — 청약홈(applyhome.go.kr)에서 더 많은 공고 확인 권장. 1~2문장.

[작성 규칙]
- 분량: 1000~1400자
- 어투: 20~30대 구어체 "-요" 체. "~입니다" 문어체 금지.
- 줄바꿈: <p> 태그 하나에 1~2문장만. 모바일 가독성 최우선.
- HTML 태그만: h2, p, ul, li, strong, a
- 없는 정보는 "LH 공고 페이지 확인"으로 처리. 지어내지 말 것.
- labels — 실제 검색어 6~8개:
  * 반드시 포함: "LH 청약", "공공임대 신청", "서울 청약"
  * "SH 청약", "공공분양 청약", "청약 공고" 형태도 포함
  * "청약 방법", "부동산 청약" 포함

[공고 목록]
${noticeList}

응답: {"title":"...","html":"...","labels":["..."]}`;
}

export async function generatePostForLhNotice(notices) {
  if (!notices?.length) throw new Error('LH 공고 없음');
  console.log(`[generateContent] LH 공고 ${notices.length}건 포스트 생성 중...`);
  const post = await runGemini(buildLhNoticePrompt(notices));
  if (!post.html || !Array.isArray(post.labels)) {
    throw new Error(`필수 필드 누락: ${JSON.stringify(post)}`);
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  post.title = `${year}년 ${month}월 LH·SH 청약 공고 총정리 - 공공임대·분양 신청 정보`;

  console.log(`[generateContent] 완료: "${post.title}"`);
  return post;
}
