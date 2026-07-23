import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { UserSummarySchema } from './user-summary.schema';

// 루트·답글 목록이 공유하는 페이지 쿼리 — 커서 의미(댓글 id keyset)가 동일하다.
const CommentPageQuerySchema = z.object({
  // keyset 커서 = 이전 페이지 마지막 댓글 id (post 목록과 같은 plain id — 단 방향이
  // 반대: 댓글은 등록순 id ASC라 "그보다 새것"을 준다). deletion-tolerant.
  cursor: z.uuid().optional().meta({
    description:
      '이전 페이지 마지막 댓글 id. 생략 시 첫 페이지. 삭제된 id여도 동작(존재 검사 없음)',
  }),
  limit: z.coerce.number().int().min(1).max(50).default(20).meta({
    description: '페이지 크기 (1–50, 기본 20)',
  }),
});

export class CommentPageQueryDto extends createZodDto(CommentPageQuerySchema) {}

const replyCountField = z.int().min(0).meta({
  description:
    '이 루트에 달린 답글 수 — "답글 N개 보기" 렌더용. 상세는 GET /comments/:id/replies',
});

// 루트 목록 아이템 — deleted가 가르는 discriminated union. 삭제된 댓글(답글이 있어
// soft delete된 루트)은 content·author 키 자체가 스펙에 없다 — null 채움 대신 구조로
// 표현해 계약이 거짓말하지 않는다(codegen도 narrowing을 얻는다).
const RootCommentItemSchema = z.discriminatedUnion('deleted', [
  z.object({
    deleted: z.literal(false),
    id: z.uuid(),
    content: z.string().meta({
      example: '저희 집 몬스테라도 그랬는데 물 주기를 늘리니 좋아졌어요',
    }),
    author: UserSummarySchema,
    replyCount: replyCountField,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
  z.object({
    deleted: z.literal(true).meta({
      description:
        '답글이 남아 있어 자리만 보존된 삭제 댓글 — 클라가 "삭제된 댓글입니다"로 렌더',
    }),
    id: z.uuid(),
    replyCount: replyCountField,
    createdAt: z.iso.datetime(),
  }),
]);

const CommentListSchema = z.object({
  comments: z.array(RootCommentItemSchema).meta({
    description: '루트 댓글만(등록순) — 답글은 GET /comments/:id/replies로 지연 로드',
  }),
  nextCursor: z.uuid().nullable().meta({
    description: '다음 페이지 cursor — null이면 마지막 페이지',
  }),
});

export class CommentListDto extends createZodDto(CommentListSchema) {}
