import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  USER_PLANT_IMAGES_MAX,
  USER_PLANT_NAME_MAX_LENGTH,
} from '../../domain/user-plant';
import { UserPlantImageInputSchema } from './user-plant-image-input.schema';

// JSON Merge Patch(RFC 7396): 필드 부재 = 미변경, null = 해제, 값 = 교체.
// 전 필드 optional은 "만능 DTO"(§9 금지)가 아니라 merge-patch의 정직한 계약이다 —
// create DTO는 그대로 strict하고, 이 DTO는 PATCH 하나의 계약만 담당한다.
const UpdateUserPlantSchema = z
  .object({
    // name은 notnull 컬럼 — 교체만 가능, null(해제) 불가.
    name: z
      .string()
      .trim()
      .min(1)
      .max(USER_PLANT_NAME_MAX_LENGTH)
      .optional()
      .meta({ description: '개체 애칭 — 항상 있어야 하는 필드라 null 불가', example: '초록이' }),
    plantId: z.uuid().nullable().optional().meta({
      description:
        '카탈로그(plants) 연결 — 값 = 동정 승격(연결), null = 연결 해제(미동정으로 강등)',
    }),
    // ⚠️ create와 달리 .default([]) 금지 — 부재(미변경)와 [](전체 제거)를 구분해야 한다.
    images: z
      .array(UserPlantImageInputSchema)
      .max(USER_PLANT_IMAGES_MAX)
      .optional()
      .meta({
        description:
          '전체 교체 배열(per-item patch 아님) — [] = 모두 제거. 교체돼도 기존 S3 객체는 지우지 않는다',
      }),
    adoptedAt: z.iso.date().nullable().optional().meta({
      description: '데려온 날 (달력 날짜) — null = 지움',
      example: '2026-05-01',
    }),
    memo: z.string().trim().min(1).max(1000).nullable().optional().meta({
      description: 'null = 지움',
      example: '거실 창가에서 키우는 중',
    }),
  })
  // 빈 패치는 no-op PATCH = 클라 버그 — 경계에서 400 (drizzle .set({})도 throw라 fail-fast).
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: '수정할 필드가 최소 하나 필요합니다',
  });

export class UpdateUserPlantDto extends createZodDto(UpdateUserPlantSchema) {}
