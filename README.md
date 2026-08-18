# 서울로그 블로그 자동화

서울 공공 데이터와 Gemini AI를 활용해 **하루 최대 5개 블로그 포스트**를 자동 생성·발행하는 파이프라인.
GitHub Actions로 스케줄 실행 — 서버 상시 구동 없음, 전 구성요소 무료 티어.

**블로그**: [seoul-log.blogspot.com](https://seoul-log.blogspot.com)

---

## 발행 스케줄

| 시간 (KST) | 일/월/수/금 | 화/목 | 토 |
|---|---|---|---|
| 09:00 | 서울 문화행사 ① | 구별 무료 문화 프로그램 | 정책뉴스 |
| 11:00 | 청약 가이드 | 청약 가이드 | 청약 가이드 |
| 12:00 | 서울 문화행사 ② | — | — |
| 15:00 | 서울 문화행사 ③ | — (하루 1회 제한) | — (하루 1회 제한) |
| 18:00 | LH·SH 청약 공고 | LH·SH 청약 공고 | LH·SH 청약 공고 |
| **합계** | **최대 5개** | **3개** | **3개** |

**주간 최대 29개** (일 평균 약 4개)

---

## 콘텐츠 파이프라인

| 파이프라인 | 데이터 소스 | 내용 |
|---|---|---|
| 서울 문화행사 | 서울 열린데이터광장 API | 오늘 진행 중인 행사 1개, 순위별 선택 |
| 구별 무료 문화 프로그램 | 서울 열린데이터광장 API | 한 자치구 무료 시설 2~3개 모음 |
| 청약 가이드 | 30개 주제 로테이션 | 에버그린 청약 입문 가이드 |
| LH·SH 청약 공고 | 공공데이터포털 LH API | 최신 공공임대·분양 공고 (없으면 청약가이드 대체) |
| 정책뉴스 | 정책브리핑 API | 서울 시민 관련 정책 뉴스 요약 |

### 포스트 기능
- **카테고리 라벨** 자동 태깅: `서울 문화행사` / `무료 문화 프로그램` / `청약·부동산` / `정책뉴스`
- **SVG 썸네일** 자동 생성: 이미지 없는 글에 카테고리별 컬러 썸네일 삽입 (토큰 소모 없음)
- **시설별 이미지**: 무료 문화 프로그램 글에 시설마다 개별 이미지 + 줄바꿈
- **청약 가이드 요약**: 상단 "핵심 정리 바로가기" + 하단 핵심 정리 박스
- **교통/주차 정보**: 행사 포스트에 카카오 로컬 API로 근처 주차장 자동 포함
- **중복 방지**: 오늘 발행된 포스트 제목 체크 후 동일 행사 재발행 차단
- **에러 알림**: Discord 웹훅으로 발행 성공/실패 알림

---

## 아키텍처

```
GitHub Actions (크론 스케줄 — 하루 최대 5회)
    ↓
index.js (시간·요일 기반 파이프라인 라우팅)
    ↓               ↓                  ↓
서울/LH/정책 API  scraper.js        Kakao 로컬 API
(데이터 수집)    (행사 페이지 스크랩)  (근처 주차장)
    ↓
generateContent.js (Gemini API — 블로그 원고 생성)
    ↓
thumbnail.js (이미지 없으면 SVG 썸네일 자동 생성)
    ↓
blogger.js (Blogger API v3 발행)
    ↓
Discord 웹훅 (성공/실패 알림)
```

---

## 환경변수

| 변수명 | 설명 | 발급처 |
|---|---|---|
| `SEOUL_OPEN_DATA_API_KEY` | 서울 공공데이터 API 키 | [data.seoul.go.kr](https://data.seoul.go.kr) → 마이페이지 → 인증키 신청 |
| `GEMINI_API_KEY` | Gemini API 키 | [aistudio.google.com](https://aistudio.google.com) → Get API key |
| `GOOGLE_CLIENT_ID` | OAuth 클라이언트 ID | [console.cloud.google.com](https://console.cloud.google.com) → OAuth 클라이언트 (데스크톱 앱) |
| `GOOGLE_CLIENT_SECRET` | OAuth 클라이언트 시크릿 | 위와 동일 |
| `GOOGLE_REFRESH_TOKEN` | OAuth refresh token | [OAuth Playground](https://developers.google.com/oauthplayground) |
| `BLOGGER_BLOG_ID` | 블로그 ID | blogger.com → 블로그 설정 |
| `BLOGGER_IS_DRAFT` | `true`=초안, `false`=즉시공개 | workflow 파일에서 설정 |
| `KAKAO_REST_API_KEY` | 카카오 로컬 API 키 | [developers.kakao.com](https://developers.kakao.com) |
| `POLICY_NEWS_API_KEY` | 정책브리핑·LH API 키 | [data.go.kr](https://www.data.go.kr) (LH API 별도 승인 필요) |
| `DISCORD_WEBHOOK_URL` | Discord 알림 웹훅 | Discord → 채널 설정 → 연동 → 웹훅 |

---

## 로컬 실행

```bash
npm install
cp .env.example .env   # .env에 실제 키 입력
node index.js
```

---

## GitHub Actions 설정

저장소 → **Settings → Secrets and variables → Actions → New repository secret**

등록할 Secrets: `SEOUL_OPEN_DATA_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `BLOGGER_BLOG_ID`,
`KAKAO_REST_API_KEY`, `POLICY_NEWS_API_KEY`, `DISCORD_WEBHOOK_URL`

수동 실행: 저장소 → **Actions → Run workflow**

---

## Google OAuth refresh_token 발급

1. [Google Cloud Console](https://console.cloud.google.com) → Blogger API v3 활성화
2. **OAuth 클라이언트 ID 만들기** → 유형: **데스크톱 앱**
3. [OAuth Playground](https://developers.google.com/oauthplayground) 접속
   - 톱니바퀴 → **Use your own OAuth credentials** → client_id, secret 입력
4. Scope: `https://www.googleapis.com/auth/blogger` → Authorize
5. Exchange authorization code → `refresh_token` 복사

> OAuth 앱을 **게시(Production)** 상태로 전환해야 refresh_token이 만료되지 않음.
> Google Cloud Console → OAuth 동의 화면 → 앱 게시

---

## 유지관리 스크립트

```bash
# 구이름+키워드 합쳐진 라벨 분리 (예: "마포구 데이트" → "마포구", "데이트")
node scripts/fix-labels.js

# 기존 포스트에 카테고리 라벨 일괄 추가
node scripts/add-category-labels.js
```

---

## 주의사항

- `.env` 파일은 절대 git에 커밋하지 말 것 (`.gitignore` 등록됨)
- Gemini 무료 티어: 1일 1,500 요청 한도 / `gemini-2.5-flash` 모델 사용
- LH API는 공공데이터포털에서 별도 승인 필요 — 미승인 시 청약 가이드로 자동 대체
- 서울 열린데이터광장 API 일일 호출 한도 → [마이페이지](https://data.seoul.go.kr)에서 확인
