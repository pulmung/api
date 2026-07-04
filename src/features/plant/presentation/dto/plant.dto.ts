import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { plantCategories } from '../../domain/plant-category';

const PlantSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  // key(불투명) 그대로 — 읽기 URL 조합(FILE_BASE_URL)은 첫 읽기 경로(조회)에서 도입 예정.
  images: z.array(
    z.object({
      key: z.string(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
    }),
  ),
  genus: z.string().nullable(),
  species: z.string().nullable(),
  category: z.enum(plantCategories).nullable(),
  createdAt: z.iso.datetime(),
});

export class PlantDto extends createZodDto(PlantSchema) {}
