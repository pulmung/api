import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { UserSummarySchema } from './user-summary.schema';

const CommentIdParamSchema = z.object({
  id: z.uuid().meta({ description: '댓글 id (루트 또는 답글)' }),
});

export class CommentIdParamDto extends createZodDto(CommentIdParamSchema) {}

const CommentPostIdParamSchema = z.object({
  postId: z.uuid().meta({ description: '게시글 id' }),
});

export class CommentPostIdParamDto extends createZodDto(
  CommentPostIdParamSchema,
) {}

// 단건 표현 — 루트 작성 201·답글 작성 201·수정 200(재조회)이 공유(변경 이유 동일).
// 목록 아이템과 달리 parentId 포함: URL 컨텍스트가 없어 응답이 스스로 말해야 한다.
// replyCount는 목록 컨텍스트의 집계라 없다 — 없는 값을 0으로 채우지 않는다.
const CommentSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable().meta({
    description: 'null = 루트 댓글, 값 = 이 답글이 속한 루트 댓글 id',
  }),
  content: z.string().meta({
    example: '저희 집 몬스테라도 그랬는데 물 주기를 늘리니 좋아졌어요',
  }),
  author: UserSummarySchema,
  mentionedUser: UserSummarySchema.nullable().meta({
    description:
      '답글이 지목한 유저("답글에 답글"의 구조화 멘션) — 루트 댓글·일반 답글이면 null. ' +
      '렌더 시 닉네임을 본문 앞에 @로 붙이는 건 클라 몫(서버는 텍스트에 섞지 않는다)',
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export class CommentDto extends createZodDto(CommentSchema) {}
