import { z } from 'zod';

// 유저를 "남에게 보여줄 때"의 최소 표현 — user가 소유하고 다른 feature가 가져다 쓴다
// (comment: 작성자·멘션 / post: 작성자). 소유권이 user에 있어야 하는 이유는 이 모양이
// 바뀌는 계기가 "유저를 어떻게 요약하나"이지 댓글·글의 사정이 아니기 때문.
// named component(.meta id)는 아직 미부여 — 붙이면 스펙에 $ref로 호이스팅돼 프론트
// codegen 타입 표면이 바뀐다. 인라인 중복이 실제로 거슬릴 때 별도로 판단한다(§9).
export const UserSummarySchema = z.object({
  id: z.uuid(),
  nickname: z.string().meta({ example: '식집사' }),
});
