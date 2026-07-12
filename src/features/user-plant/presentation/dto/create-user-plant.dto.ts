import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  USER_PLANT_IMAGES_MAX,
  USER_PLANT_NAME_MAX_LENGTH,
} from '../../domain/user-plant';
import { UserPlantImageInputSchema } from './user-plant-image-input.schema';

const CreateUserPlantSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(USER_PLANT_NAME_MAX_LENGTH)
    .meta({ description: '개체 애칭', example: '초록이' }),
  plantId: z.uuid().optional().meta({
    description: '카탈로그(plants) 참조 — 무슨 식물인지 모르면 생략(추후 연결)',
  }),
  // 첫 요소 = 대표/커버.
  // 빈 배열 허용(.default([])) — 사진 없이 이름만으로 등록 가능(카탈로그 ≥1과 다름).
  images: z
    .array(UserPlantImageInputSchema)
    .max(USER_PLANT_IMAGES_MAX)
    .default([]),
  adoptedAt: z.iso.date().optional().meta({
    description: '데려온 날 (달력 날짜)',
    example: '2026-05-01',
  }),
  memo: z.string().trim().min(1).max(1000).optional().meta({
    example: '거실 창가에서 키우는 중',
  }),
});

export class CreateUserPlantDto extends createZodDto(CreateUserPlantSchema) {}
