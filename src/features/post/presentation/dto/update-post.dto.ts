import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { POST_TITLE_MAX_LENGTH } from '../../domain/post';
import { POST_CONTENT_MAX_LENGTH } from '../../domain/post-content';

// JSON Merge Patch(RFC 7396): 필드 부재 = 미변경, null = 해제, 값 = 교체.
// 전 필드 optional은 "만능 DTO"(§9 금지)가 아니라 merge-patch의 정직한 계약이다.
const UpdatePostSchema = z
  .object({
    // notnull 컬럼 — 교체만 가능, null(해제) 불가.
    title: z.string().trim().min(1).max(POST_TITLE_MAX_LENGTH).optional(),
    // 통짜 교체 — 제공 시 서버가 재정화(sanitize)하고 파생(발췌·썸네일·이미지 인덱스)을
    // 재계산한다. 규약은 POST /posts의 content와 동일.
    content: z.string().min(1).max(POST_CONTENT_MAX_LENGTH).optional(),
    plantId: z.uuid().nullable().optional().meta({
      description: '식물 태그 — 값 = 교체, null = 태그 해제',
    }),
  })
  // 빈 패치는 no-op PATCH = 클라 버그 — 경계에서 400 (drizzle .set({})도 throw라 fail-fast).
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: '수정할 필드가 최소 하나 필요합니다',
  });

export class UpdatePostDto extends createZodDto(UpdatePostSchema) {}
