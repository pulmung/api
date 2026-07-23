import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { commentContentField } from './comment-content.field';

const CreateReplySchema = z.object({
  content: commentContentField,
  mentionedUserId: z.uuid().optional().meta({
    description:
      '지목할 유저 id — "답글에 답글" 시 그 답글의 작성자를 넣는다(클라가 결정). ' +
      '루트에 다는 일반 답글이면 생략',
  }),
});

export class CreateReplyDto extends createZodDto(CreateReplySchema) {}
