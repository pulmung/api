import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { UserSummarySchema } from '../../../user/presentation/shared/user-summary.schema';

const BlockListQuerySchema = z.object({
  // keyset 커서 = 이전 페이지 마지막 항목의 **상대 유저 id**. 차단은 순수 관계 테이블이라
  // 자기 id가 없고, 정렬 기준이 pk(blocker_id, blocked_id)의 두 번째 컬럼이다.
  cursor: z.uuid().optional().meta({
    description:
      '이전 페이지 마지막 항목의 user.id. 생략 시 첫 페이지. 해제된 id여도 동작(존재 검사 없음)',
  }),
  limit: z.coerce.number().int().min(1).max(50).default(20).meta({
    description: '페이지 크기 (1–50, 기본 20)',
  }),
});

export class BlockListQueryDto extends createZodDto(BlockListQuerySchema) {}

const BlockListSchema = z.object({
  blocks: z
    .array(
      z.object({
        user: UserSummarySchema,
        createdAt: z.iso.datetime().meta({ description: '차단한 시각' }),
      }),
    )
    .meta({
      description:
        '내가 차단한 유저들 — 해제 UI용. 정렬은 user.id 오름차순(차단 시각순이 아니다)',
    }),
  nextCursor: z.uuid().nullable().meta({
    description: '다음 페이지 cursor — null이면 마지막 페이지',
  }),
});

export class BlockListDto extends createZodDto(BlockListSchema) {}
