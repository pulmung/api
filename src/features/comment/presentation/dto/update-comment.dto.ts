import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { commentContentField } from './comment-content.field';

// 수정 가능한 것은 본문뿐(구조·멘션은 불변) — merge-patch 의미론이 필요 없어
// content가 required다(post의 all-optional + refine과 의도된 편차).
const UpdateCommentSchema = z.object({
  content: commentContentField,
});

export class UpdateCommentDto extends createZodDto(UpdateCommentSchema) {}
