import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  USER_PLANT_IMAGES_MAX,
  USER_PLANT_NAME_MAX_LENGTH,
} from '../../domain/user-plant';

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
  // 첫 요소 = 대표/커버. key는 POST /files(purpose: user-plant-image)로 발급받은 값.
  // 빈 배열 허용(.default([])) — 사진 없이 이름만으로 등록 가능(카탈로그 ≥1과 다름).
  // prefix 등 형식 위반은 400(Zod)이 아니라 422(도메인)로 갈라진다 — 규칙은 도메인 소유.
  images: z
    .array(
      z.object({
        key: z.string().min(1).meta({
          example: 'user-plant-image/0198c5b2-2f74-7abc-8def-0123456789ab.jpg',
        }),
        // 클라 제공 힌트(피드 CLS 방지용) — 서버는 실존(head)만 검증한다.
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      }),
    )
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
