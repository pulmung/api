import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PlantImageSchema } from '../../../plant/presentation/dto/plant-image.schema';

const UserPlantDetailSchema = z.object({
  id: z.uuid(),
  name: z.string().meta({ description: '개체 애칭', example: '초록이' }),
  // 첫 요소 = 대표/커버. 빈 배열 가능(사진 없는 등록) — .min(1) 없음.
  // PlantImageSchema는 named component 단일 인스턴스 재사용(복제 시 duplicate-id 충돌).
  images: z.array(PlantImageSchema),
  // 연결된 카탈로그 요약 — 미동정이면 null. 개체 name(애칭)과 카탈로그 name(종명)의
  // 키 충돌은 중첩으로 푼다.
  plant: z
    .object({
      id: z.uuid(),
      name: z.string().meta({ example: '몬스테라 알보' }),
    })
    .nullable()
    .meta({ description: '연결된 카탈로그 식물 — 미동정이면 null' }),
  adoptedAt: z.iso.date().nullable().meta({ description: '데려온 날' }),
  memo: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export class UserPlantDetailDto extends createZodDto(UserPlantDetailSchema) {}
