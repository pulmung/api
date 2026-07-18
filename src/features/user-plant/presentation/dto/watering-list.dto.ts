import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { WateringSchema } from './watering.schema';

const WateringListQuerySchema = z.object({
  // keyset 커서 = 이전 페이지 마지막 wateredOn — UNIQUE(개체, 날짜) 덕에 개체 내
  // 전순서라 id tie-breaker가 필요 없다. 존재 검사 없음(deletion-tolerant).
  cursor: z.iso.date().optional().meta({
    description:
      '이전 페이지 마지막 wateredOn. 생략 시 첫 페이지. 삭제된 날짜여도 동작(존재 검사 없음)',
  }),
  limit: z.coerce.number().int().min(1).max(50).default(20).meta({
    description: '페이지 크기 (1–50, 기본 20)',
  }),
});

export class WateringListQueryDto extends createZodDto(
  WateringListQuerySchema,
) {}

const WateringListSchema = z.object({
  waterings: z
    .array(WateringSchema)
    .meta({ description: '물주기 이력 — 최신순(wateredOn DESC)' }),
  nextCursor: z.iso.date().nullable().meta({
    description: '다음 페이지 cursor — null이면 마지막 페이지',
  }),
});

export class WateringListDto extends createZodDto(WateringListSchema) {}
