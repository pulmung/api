import { describe, it, expect } from 'vitest';
import { addDaysToCalendarDate, nextWateringOn } from './watering-schedule';

describe('addDaysToCalendarDate', () => {
  it.each([
    ['월중 +7', '2026-07-01', 7, '2026-07-08'],
    ['월말 롤오버', '2026-01-31', 1, '2026-02-01'],
    ['연말 롤오버', '2026-12-31', 1, '2027-01-01'],
    ['윤년 2월 (2024)', '2024-02-28', 1, '2024-02-29'],
    ['평년 2월 (2025)', '2025-02-28', 1, '2025-03-01'],
    ['윤일에서 +365 (다음 해엔 2-29 없음)', '2024-02-29', 365, '2025-02-28'],
    ['zero-pad 왕복 (한 자리 월·일)', '2026-01-01', 8, '2026-01-09'],
    ['+365 (평년)', '2026-07-18', 365, '2027-07-18'],
  ])('%s: %s + %d일 = %s', (_, date, days, expected) => {
    expect(addDaysToCalendarDate(date, days)).toBe(expected);
  });
});

describe('nextWateringOn', () => {
  it('간격과 마지막 기록이 둘 다 있으면 파생한다', () => {
    expect(nextWateringOn('2026-07-01', 7)).toBe('2026-07-08');
  });

  // 한쪽이라도 없으면 예정일이 존재하지 않는다 — 간격 없음 = 관리 안 함,
  // 기록 없음 = 앵커 없음(첫 기록 전).
  it.each([
    ['간격만 있음 (기록 없음)', null, 7],
    ['기록만 있음 (간격 없음)', '2026-07-01', null],
    ['둘 다 없음', null, null],
  ])('%s 이면 null', (_, lastWateredOn, intervalDays) => {
    expect(nextWateringOn(lastWateredOn, intervalDays)).toBeNull();
  });
});
