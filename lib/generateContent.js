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
   - 주차장 데이터 있으면 각 주차장을 <li>로 표시: 이름(링크), 도보 거리, 요금 정보 모두 포함.
   - 요금이 "현장 확인"이면 그대로 표기. "가급적 대중교통" 같은 뻔한 멘트 금지.
   - 데이터 없으면: 주차 공간 유무만 간단히 언급.
   - 마지막에 "주차 공간이 협소할 수 있으니 대중교통 이용도 고려해보세요." 한 줄.

8. <h2>❓ 자주 묻는 질문</h2>
   - 독자가 실제로 궁금해할 Q&A 2~3개. 예약 방법·대상·준비물·취소 정책 등에서 가장 현실적인 것 골라서.
   - 형식: <p><strong>Q. 질문?</strong></p><p>A. 답변</p>

9. <p><a href="[orgLink]" target="_blank" rel="noopener">[행사명] 공식 페이지 바로가기 →</a></p>
   (orgLink 없고 homepageUrl 있으면 그것 사용. 둘 다 없으면 생략.)

[작성 규칙]
- 분량: ${lengthGuide}
- 어투: 20~30대 구어체, "-요" 체. "~입니다" 문어체 금지. AI 티 나는 뻔한 문장 금지.
- 줄바꿈: <p> 태그 하나에 1~2문장만. 문장이 3개 이상이면 반드시 <p>를 나눌 것. 모바일 가독성 최우선.
- HTML 태그만: h2, p, ul, li, strong, a. 다른 태그 금지.
- 없는 정보 절대 지어내지 말 것.
- SEO title: 숫자나 연도 포함, "[행사명] [장소/구이름] [연도/월] 무료" 형식. 클릭하고 싶은 제목으로.
- labels 규칙 — 실제 검색어 형태로 6~8개:
  * 문장형·조합형 우선: "[구이름] 무료 주말", "[대상] 서울 나들이", "이번 주 서울 무료"
  * 반드시 포함: "서울 볼거리", "서울 놀거리", "서울 가볼만한곳" 중 2개 이상
  * 카테고리 단어 단독 사용 금지 (예: "전시" ❌ → "서울 무료 전시" ✅)
  * "[구이름] 데이트", "[구이름] 나들이" 형태도 포함

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
- SEO title: 시설이 2개 이상이면 "${district} 무료 문화 프로그램 [연도/월] 모음", 1개면 "[프로그램명] ${district} [연도/월] 무료 체험 안내" 형식 사용. 절대 1개짜리에 "모음" 사용 금지.
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

// ─── 3. 정책뉴스 모음 포스트 ──────────────────────────────────────────────────

function buildPolicyNewsPrompt(newsItems) {
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  const newsList = newsItems.map((n, i) => `[${i + 1}] ${n.title}
  부처: ${n.ministry}
  요약: ${n.subtitle || n.summary.substring(0, 150)}
  원문: ${n.url}`).join('\n\n');

  return `당신은 서울 시민을 위한 생활 정보 블로그 에디터입니다.
오늘 날짜: ${today}

아래 정부 정책뉴스 기사들을 서울 시민 입장에서 쉽고 실용적으로 정리한 블로그 포스트를 작성해주세요.
딱딱한 행정 용어 대신 "나에게 어떤 영향이 있는가?"에 초점을 맞춰주세요.

[HTML 구조]
1. <p> 도입부 </p> — 오늘 정책뉴스 중 서울 시민 생활과 관련된 소식이 있다는 내용 2~3문장
2. 각 기사마다:
   <h2>[번호]. 기사 제목 (핵심 요약)</h2>
   <p> 이 정책이 일반 시민에게 어떤 의미인지 2~3문장으로 설명 </p>
   <p><a href="[원문URL]" target="_blank" rel="noopener">자세한 내용 보기 →</a></p>
3. <p> 마무리 </p> — 1~2문장

[작성 규칙]
- 분량: 1000~1500자
- 어투: 친근한 구어체 "-요" 체. 어려운 정책 용어는 쉽게 풀어서.
- HTML 태그만: h2, p, ul, li, strong, a
- 출처 표기: 각 기사에 "정책브리핑(www.korea.kr)" 출처 명시
- SEO title: "오늘의 정책 뉴스 [날짜] — 서울 시민 생활 정보"
- labels — 실제 검색어 5~7개:
  * "서울 정책 뉴스", "오늘의 정부 소식", "서울 시민 생활 정보"
  * "서울 볼거리", "서울 놀거리", "서울 가볼만한곳" 중 2개 이상 포함

[오늘의 정책뉴스]
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
