import { z } from 'zod';

// 유저를 "남에게 보여줄 때"의 최소 표현 — user가 소유하고 다른 feature가 가져다 쓴다
// (comment: 작성자·멘션 / post: 작성자 / moderation: 차단 목록). 소유권이 user에 있어야
// 하는 이유는 이 모양이 바뀌는 계기가 "유저를 어떻게 요약하나"이지 댓글·글의 사정이 아니기 때문.
// named component(.meta id)는 아직 미부여 — 붙이면 스펙에 $ref로 호이스팅돼 프론트
// codegen 타입 표면이 바뀐다. 인라인 중복이 실제로 거슬릴 때 별도로 판단한다(§9).
//
// 읽기 쪽 짝: projection은 `repository/user-summary.columns.ts`, key→URL 변환은
// `application/user-summary.ts`. 이 스키마에 필드를 더하면 그 둘도 같이 움직인다
// (아바타 추가 때 실제로 reader 3곳·query service 3곳이 함께 바뀌었고, 누락은 컴파일 에러다).
export const UserSummarySchema = z.object({
  id: z.uuid(),
  nickname: z.string().meta({ example: '식집사' }),
  profileImageUrl: z.url().nullable().meta({
    description:
      '아바타 읽기 URL — null이면 미설정(기본 이미지는 클라가 렌더한다)',
    example: 'https://cdn.pulmung.com/user-profile-image/018f2e6a.jpg',
  }),
});
