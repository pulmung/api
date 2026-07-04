import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { plantCategories } from '../../domain/plant-category';
import { PLANT_IMAGES_MAX, PLANT_NAME_MAX_LENGTH } from '../../domain/plant';

const CreatePlantSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(PLANT_NAME_MAX_LENGTH)
    .meta({ example: '몬스테라 알보' }),
  // 첫 요소 = 대표/커버. key는 POST /files(purpose: plant-image)로 발급받은 값.
  // prefix 등 형식 위반은 400(Zod)이 아니라 422(도메인)로 갈라진다 — 규칙은 도메인 소유.
  images: z
    .array(
      z.object({
        key: z.string().min(1).meta({
          example: 'plant-image/0198c5b2-2f74-7abc-8def-0123456789ab.jpg',
        }),
        // 클라 제공 힌트(피드 CLS 방지용) — 서버는 실존(head)만 검증한다.
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      }),
    )
    .min(1)
    .max(PLANT_IMAGES_MAX),
  genus: z.string().trim().min(1).max(100).optional().meta({
    description: '속 — 자유 텍스트(genera 사전은 제안 소스일 뿐)',
    example: '몬스테라',
  }),
  species: z.string().trim().min(1).max(100).optional().meta({
    description: '종 — 자유 텍스트',
    example: '델리시오사',
  }),
  category: z.enum(plantCategories).optional(),
});

export class CreatePlantDto extends createZodDto(CreatePlantSchema) {}
