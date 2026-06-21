// 카테고리 — 속/종과 무관한 별개 분류 축. 큐레이션된 닫힌 집합(enum).
// 유저 자유입력 대상이 아니다(주 브라우즈 축이라 깨끗하게 유지). 추가는 이 배열에 한 줄.
// 값은 KR-only 서비스의 도메인 통용 표기(한글)를 그대로 wire 값으로 쓴다.
export const plantCategories = [
  '관엽',
  '다육',
  '선인장',
  '난초',
  '허브',
  '식충',
] as const;

export type PlantCategory = (typeof plantCategories)[number];
