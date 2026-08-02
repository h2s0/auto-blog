# 서울 소식 블로그 자동화

서울 열린데이터광장의 문화행사 정보를 매일 수집하여 Gemini AI로 블로그 글을 생성하고 Blogger에 자동 발행하는 파이프라인.

**GitHub Actions가 매일 KST 09:00에 실행. 서버 상시 구동 없음. 전 구성요소 무료 티어.**

## 아키텍처

```
GitHub Actions (매일 KST 09:00)
    → 서울 열린데이터광장 API (오늘의 문화행사 수집)
    → Gemini API gemini-2.5-flash (블로그 원고 생성)
    → Blogger API v3 (자동 발행)
```

## 필요한 환경변수

| 변수명 | 설명 | 발급처 |
|---|---|---|
| `SEOUL_OPEN_DATA_API_KEY` | 서울 공공데이터 API 키 | [data.seoul.go.kr](https://data.seoul.go.kr) → 마이페이지 → 인증키 신청 |
| `GEMINI_API_KEY` | Gemini API 키 | [aistudio.google.com](https://aistudio.google.com) → Get API key |
| `GOOGLE_CLIENT_ID` | OAuth 클라이언트 ID | [console.cloud.google.com](https://console.cloud.google.com) → OAuth 클라이언트 (데스크톱 앱) |
| `GOOGLE_CLIENT_SECRET` | OAuth 클라이언트 시크릿 | 위와 동일 |
| `GOOGLE_REFRESH_TOKEN` | OAuth refresh token | [OAuth Playground](https://developers.google.com/oauthplayground) |
| `BLOGGER_BLOG_ID` | 블로그 ID | blogger.com → 블로그 설정 |
| `BLOGGER_IS_DRAFT` | `true`=초안, `false`=즉시공개 | (기본값: `true`) |

## 로컬 테스트 방법

### 1. 패키지 설치

```bash
npm install
```

### 2. 환경변수 설정

```bash
cp .env.example .env
# .env 파일을 열어 각 값을 실제 키로 채운다
```

### 3. 실행

```bash
node index.js
```

성공 시 콘솔에 다음과 같이 출력됩니다:

```
=== 서울 소식 블로그 자동화 시작 ===
실행 시각: 2026. 8. 2. 오전 9:00:00
[seoulData] 오늘 날짜: 2026-08-02 기준 행사 수집 시작
[seoulData] 전체 행사 수: 450건
[seoulData] 오늘 진행 중인 행사: 38건
[generateContent] Gemini gemini-2.5-flash로 블로그 원고 생성 중...
[generateContent] 원고 생성 완료: "8월의 서울, 놓치기 아까운 문화행사 38선"
[blogger] OAuth 액세스 토큰 발급 중...
[blogger] 포스트 발행 중 (isDraft=true)...
[blogger] 발행 완료!
  제목: 8월의 서울, 놓치기 아까운 문화행사 38선
  URL: https://your-blog.blogspot.com/...
  상태: DRAFT
=== 완료 ===
```

### Google OAuth refresh_token 발급 방법 (상세)

1. [Google Cloud Console](https://console.cloud.google.com)에서 프로젝트 생성
2. **API 및 서비스 → 라이브러리**에서 "Blogger API v3" 활성화
3. **API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트 ID 만들기**
   - 유형: **데스크톱 앱** 선택
   - `client_id`와 `client_secret` 복사
4. [OAuth Playground](https://developers.google.com/oauthplayground) 접속
   - 오른쪽 위 톱니바퀴 클릭 → **"Use your own OAuth credentials"** 체크
   - `client_id`, `client_secret` 입력
5. Step 1 - scope 입력 후 Authorize:
   ```
   https://www.googleapis.com/auth/blogger
   ```
6. Step 2 - **Exchange authorization code for tokens** 클릭
7. Step 3 - `refresh_token` 값을 복사하여 환경변수에 저장

## GitHub Actions Secrets 등록 방법

1. GitHub 저장소 → **Settings → Secrets and variables → Actions**
2. **"New repository secret"** 클릭
3. 아래 6개 Secrets를 각각 등록:

| Secret 이름 | 값 |
|---|---|
| `SEOUL_OPEN_DATA_API_KEY` | 서울 API 키 |
| `GEMINI_API_KEY` | Gemini API 키 |
| `GOOGLE_CLIENT_ID` | OAuth 클라이언트 ID |
| `GOOGLE_CLIENT_SECRET` | OAuth 클라이언트 시크릿 |
| `GOOGLE_REFRESH_TOKEN` | OAuth refresh token |
| `BLOGGER_BLOG_ID` | 블로그 ID |

> `BLOGGER_IS_DRAFT`는 Secrets에 등록하지 않아도 됩니다.  
> 기본값은 `true`(초안)이며, 즉시 공개로 전환할 때는 workflow 파일에서 변경하거나  
> `workflow_dispatch` 수동 실행 시 입력값으로 `false`를 넣으면 됩니다.

### 수동 실행 방법

GitHub 저장소 → **Actions → 서울 문화행사 블로그 자동 발행 → Run workflow**

`is_draft` 옵션:
- `true` (기본값): 초안으로 저장
- `false`: 즉시 공개 발행

## 자동 공개 전환 방법

며칠간 초안으로 결과물을 확인한 뒤, 자동 공개로 전환하려면:

`.github/workflows/daily-post.yml`의 `BLOGGER_IS_DRAFT` 기본값을 변경:

```yaml
BLOGGER_IS_DRAFT: ${{ github.event.inputs.is_draft || 'false' }}
```

## 주의사항

- Gemini 무료 티어는 `gemini-2.5-flash` 모델 사용 (Pro 계열은 유료)
- 서울 열린데이터광장 API는 일일 호출 한도가 있으니 [마이페이지](https://data.seoul.go.kr)에서 확인
- `.env` 파일은 절대 git에 커밋하지 말 것 (`.gitignore`에 등록됨)
