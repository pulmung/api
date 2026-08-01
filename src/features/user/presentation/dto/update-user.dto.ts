import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from '../../domain/user';

// JSON Merge Patch(RFC 7396): 필드 부재 = 미변경, 값 = 교체, null = 해제.
const UpdateUserSchema = z
  .object({
    // nickname은 notnull 컬럼 — 교체만 가능, null(해제) 불가.
    // min/max는 도메인 상수 import — DTO(400) ↔ 도메인(422)의 이중기재 drift 차단.
    nickname: z
      .string()
      .trim()
      .min(NICKNAME_MIN_LENGTH)
      .max(NICKNAME_MAX_LENGTH)
      .optional()
      .meta({
        description: '닉네임 — 전역 유니크, 항상 있어야 하는 필드라 null 불가',
        example: '풀멍',
      }),
    // 입력은 key, 응답은 url인 비대칭은 기존 계약 그대로다(UserPlantImageInputSchema ↔
    // PlantImageSchema) — 클라는 POST /files로 받은 key를 그대로 실어 보낸다.
    // prefix 형식 위반은 400(Zod)이 아니라 422(도메인)로 갈라진다 — 규칙은 도메인 소유.
    profileImageKey: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .meta({
        description:
          'POST /files(purpose: user-profile-image)로 발급받은 key — null = 아바타 해제. ' +
          '교체돼도 기존 S3 객체는 지우지 않는다(월간 GC가 청소)',
        example: 'user-profile-image/0198c5b2-2f74-7abc-8def-0123456789ab.jpg',
      }),
  })
  // 빈 패치는 no-op PATCH = 클라 버그 — 경계에서 400 (drizzle .set({})도 throw라 fail-fast).
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: '수정할 필드가 최소 하나 필요합니다',
  });

export class UpdateUserDto extends createZodDto(UpdateUserSchema) {}
