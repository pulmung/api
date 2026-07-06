import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PlantCategorySchema } from './plant-category.schema';
import { PlantImageSchema } from './plant-image.schema';

const PlantIdParamSchema = z.object({
  id: z.uuid().meta({ description: '식물 id' }),
});

export class PlantIdParamDto extends createZodDto(PlantIdParamSchema) {}

const PlantDetailSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  // 첫 요소 = 대표/커버 (저장 순서 유지)
  images: z.array(PlantImageSchema).min(1),
  genus: z.string().nullable(),
  species: z.string().nullable(),
  category: PlantCategorySchema.nullable(),
  createdAt: z.iso.datetime(),
});

export class PlantDetailDto extends createZodDto(PlantDetailSchema) {}
