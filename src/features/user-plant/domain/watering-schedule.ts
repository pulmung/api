/**
 * 물주기 스케줄 파생 규칙 — 순수 달력 날짜('YYYY-MM-DD') 연산. Watering은 엔티티가 아니라
 * (불변식이 전부 DTO·DB 제약 몫이라 YAGNI) 파생 규칙만 도메인이 소유한다.
 */

// Date.UTC 경유 고정 연산이라 실행 환경 타임존·DST 무관. 월말/윤년은 UTC 달력
// 롤오버가 처리한다(예: 1-31 +1 → 2-01, 2024-02-28 +1 → 02-29).
export function addDaysToCalendarDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

// 다음 예정일 = 마지막 물 준 날 + 간격. 저장하지 않는 파생값 — 간격(관리 여부)과
// 기록(앵커)이 둘 다 있을 때만 존재한다. 첫 기록 전에는 null(앵커가 없어 못 긋는다).
export function nextWateringOn(
  lastWateredOn: string | null,
  wateringIntervalDays: number | null,
): string | null {
  if (lastWateredOn === null || wateringIntervalDays === null) return null;
  return addDaysToCalendarDate(lastWateredOn, wateringIntervalDays);
}
