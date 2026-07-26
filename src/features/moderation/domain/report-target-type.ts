// 신고 대상의 종류 — reports의 다형 참조(targetType + targetId) 중 판별자(discriminator).
//
// 이 배열이 늘어나는 것 = 신고 가능한 리소스가 늘어나는 것이고, 스키마 변경 없이
// 값 한 줄로 끝난다(report.table.ts doc "왜 다형인가" 참조). 커머스(상품·리뷰)·
// 채팅 메시지가 붙을 자리다.
//
// 'user'는 콘텐츠가 아니라 계정 자체에 대한 신고다(프로필·닉네임·반복 행위). 이때
// targetId === targetAuthorId가 되며, 그건 결함이 아니라 정의다.
export const reportTargetTypes = ['post', 'comment', 'user'] as const;

export type ReportTargetType = (typeof reportTargetTypes)[number];
