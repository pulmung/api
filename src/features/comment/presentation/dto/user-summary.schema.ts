import { z } from 'zod';

// 작성자·멘션 공용 유저 요약 — 파생 베이스(단독 재사용 단위가 아니라 인라인 전개로
// 충분 — post-list-item.schema의 author와 같은 결이라 named component 미부여).
export const UserSummarySchema = z.object({
  id: z.uuid(),
  nickname: z.string().meta({ example: '식집사' }),
});
