import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from '../../domain/user';

// JSON Merge Patch(RFC 7396): 필드 부재 = 미변경, 값 = 교체. (현재 patch 가능 필드는 nickname뿐)
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
      .meta({ description: '닉네임 — 전역 유니크, 항상 있어야 하는 필드라 null 불가', example: '풀멍' }),
  })
  // 빈 패치는 no-op PATCH = 클라 버그 — 경계에서 400 (drizzle .set({})도 throw라 fail-fast).
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: '수정할 필드가 최소 하나 필요합니다',
  });

export class UpdateUserDto extends createZodDto(UpdateUserSchema) {}
