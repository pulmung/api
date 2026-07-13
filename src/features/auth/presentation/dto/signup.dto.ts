import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
} from '../../../user/domain/user';
import { SocialProviderSchema } from '../../../user/presentation/dto/social-provider.schema';
import { deviceFields } from './device.fields';

const SignupSchema = z.object({
  provider: SocialProviderSchema,
  accessToken: z.string().min(1),
  // min/max는 도메인 상수 — DTO(400) ↔ 도메인(422)의 이중기재 drift 차단.
  nickname: z.string().trim().min(NICKNAME_MIN_LENGTH).max(NICKNAME_MAX_LENGTH),
  ...deviceFields,
});

export class SignupDto extends createZodDto(SignupSchema) {}
