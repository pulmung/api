import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PlantImageSchema } from '../../../plant/presentation/dto/plant-image.schema';

const UserPlantListQuerySchema = z.object({
  // keyset 커서 = 이전 페이지 마지막 개체 id (plant 카탈로그와 동일 패턴 — 정렬이
  // id DESC 하나뿐이라 opaque 인코딩이 사줄 게 없다). 존재 검사 없음(deletion-tolerant).
  cursor: z.uuid().optional().meta({
    description:
      '이전 페이지 마지막 개체 id. 생략 시 첫 페이지. 삭제된 id여도 동작(존재 검사 없음)',
  }),
  limit: z.coerce.number().int().min(1).max(50).default(20).meta({
    description: '페이지 크기 (1–50, 기본 20)',
  }),
});

export class UserPlantListQueryDto extends createZodDto(
  UserPlantListQuerySchema,
) {}

// 목록 = 요약 프로젝션 — 커버 1장 + 카드 필드만. 상세와 분리(변경 이유 다름), memo는 상세 전용.
const UserPlantListItemSchema = z.object({
  id: z.uuid(),
  name: z.string().meta({ description: '개체 애칭', example: '초록이' }),
  // PlantImageSchema는 named component 단일 인스턴스 재사용(복제 시 duplicate-id 충돌).
  coverImage: PlantImageSchema.nullable().meta({
    description:
      '커버 — 개체 사진[0], 없으면 연결된 카탈로그 대표 이미지로 폴백, 둘 다 없으면 null(플레이스홀더는 클라 몫)',
  }),
  plant: z
    .object({
      id: z.uuid(),
      name: z.string().meta({ example: '몬스테라 알보' }),
    })
    .nullable()
    .meta({ description: '연결된 카탈로그 식물 — 미동정이면 null' }),
  adoptedAt: z.iso.date().nullable().meta({ description: '데려온 날' }),
  createdAt: z.iso.datetime(),
});

const UserPlantListSchema = z.object({
  userPlants: z.array(UserPlantListItemSchema),
  nextCursor: z.uuid().nullable().meta({
    description: '다음 페이지 cursor — null이면 마지막 페이지',
  }),
});

export class UserPlantListDto extends createZodDto(UserPlantListSchema) {}
