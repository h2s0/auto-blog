/**
 * KST(Asia/Seoul) 기준 날짜/요일 유틸
 *
 * GitHub Actions 러너는 시스템 시간대가 UTC다. new Date().getDay()나
 * new Date().getFullYear() 등 로컬 기준 API를 그대로 쓰면 KST 자정~오전
 * 시간대(UTC 15~24시)에는 날짜/요일이 하루 밀려서 계산된다.
 * (예: KST 8/13 00:35 실행 시점의 UTC 날짜는 아직 8/12)
 *
 * 이 파일의 함수들은 항상 Asia/Seoul 기준으로 날짜/요일을 계산한다.
 */

// "YYYY-MM-DD" (sep=''이면 "YYYYMMDD")
export function getKstDateString(date = new Date(), sep = '-') {
  const [y, m, d] = date
    .toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' })
    .substring(0, 10)
    .split('-');
  return [y, m, d].join(sep);
}

// 0=일 ~ 6=토 (KST 기준)
export function getKstDayOfWeek(date = new Date()) {
  const [y, m, d] = getKstDateString(date).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
