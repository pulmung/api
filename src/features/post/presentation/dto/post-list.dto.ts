import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PostListItemSchema } from './post-list-item.schema';

const PostListQuerySchema = z.object({
  // keyset 커서 = 이전 페이지 마지막 글 id (Stripe식 plain id — 정렬이 id DESC 하나뿐이라
  // opaque 인코딩이 사줄 게 없다). 존재 검사 없음 → 삭제된 id여도 동작(deletion-tolerant).
  cursor: z.uuid().optional().meta({
    description:
      '이전 페이지 마지막 글 id. 생략 시 첫 페이지. 삭제된 id여도 동작(존재 검사 없음)',
  }),
  limit: z.coerce.number().int().min(1).max(50).default(20).meta({
    description: '페이지 크기 (1–50, 기본 20)',
  }),
  // 필터 — 각각 (fk, id) 복합 인덱스가 커서 정렬까지 커버한다.
  plantId: z.uuid().optional().meta({
    description: '이 카탈로그 식물이 태그된 글만',
  }),
  authorId: z.uuid().optional().meta({
    description: '이 유저가 작성한 글만 (프로필 글 목록)',
  }),
});

export class PostListQueryDto extends createZodDto(PostListQuerySchema) {}

const PostListSchema = z.object({
  posts: z.array(PostListItemSchema),
  nextCursor: z.uuid().nullable().meta({
    description: '다음 페이지 cursor — null이면 마지막 페이지',
  }),
});

export class PostListDto extends createZodDto(PostListSchema) {}
