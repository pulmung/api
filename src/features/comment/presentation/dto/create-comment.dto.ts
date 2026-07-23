import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { commentContentField } from './comment-content.field';

// 루트 댓글 작성 — parentId·mentionedUserId 필드 자체가 없다(멘션은 답글 전용,
// 불변식을 계약 구조로 강제 — 도메인 팩토리 이분화와 같은 결).
const CreateCommentSchema = z.object({
  content: commentContentField,
});

export class CreateCommentDto extends createZodDto(CreateCommentSchema) {}
