import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PlantCategorySchema } from './plant-category.schema';
import { PlantImageSchema } from './plant-image.schema';

const PlantListQuerySchema = z.object({
  // keyset 커서 = 이전 페이지 마지막 식물 id (Stripe식 plain id — 정렬이 id DESC 하나뿐이라
  // opaque 인코딩이 사줄 게 없다). 존재 검사 없음 → 삭제된 id여도 동작(deletion-tolerant).
  cursor: z.uuid().optional().meta({
    description:
      '이전 페이지 마지막 식물 id. 생략 시 첫 페이지. 삭제된 id여도 동작(존재 검사 없음)',
  }),
  limit: z.coerce.number().int().min(1).max(50).default(20).meta({
    description: '페이지 크기 (1–50, 기본 20)',
  }),
});

export class PlantListQueryDto extends createZodDto(PlantListQuerySchema) {}

// 목록 = 요약 프로젝션 — 이미지는 커버(images[0]) 1장만. 상세와 분리(변경 이유 다름).
const PlantListItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  // 도메인 불변식(이미지 ≥1)이라 커버는 항상 존재.
  coverImage: PlantImageSchema,
  genus: z.string().nullable(),
  species: z.string().nullable(),
  category: PlantCategorySchema.nullable(),
  createdAt: z.iso.datetime(),
});

const PlantListSchema = z.object({
  plants: z.array(PlantListItemSchema),
  nextCursor: z.uuid().nullable().meta({
    description: '다음 페이지 cursor — null이면 마지막 페이지',
  }),
});

export class PlantListDto extends createZodDto(PlantListSchema) {}
