import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { UserSummarySchema } from './user-summary.schema';

// 답글 아이템 — 답글은 soft delete가 없어(자식이 없다 — 삭제 삼분기) union 불요.
// parentId는 URL(:id)이 이미 말하므로 제외. 페이지 쿼리는 CommentPageQueryDto 공유.
const ReplyItemSchema = z.object({
  id: z.uuid(),
  content: z.string().meta({ example: '맞아요, 과습이 원인일 때가 많더라고요' }),
  author: UserSummarySchema,
  mentionedUser: UserSummarySchema.nullable().meta({
    description: '지목된 유저("답글에 답글" 멘션) — 일반 답글이면 null',
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const ReplyListSchema = z.object({
  replies: z.array(ReplyItemSchema).meta({ description: '등록순(id ASC)' }),
  nextCursor: z.uuid().nullable().meta({
    description: '다음 페이지 cursor — null이면 마지막 페이지',
  }),
});

export class ReplyListDto extends createZodDto(ReplyListSchema) {}
