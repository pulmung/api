import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { socialProviders } from '../../../user/domain/social-provider';

const SignupSchema = z.object({
  provider: z.enum(socialProviders),
  accessToken: z.string().min(1),
  nickname: z.string().trim().min(2).max(20),
});

export class SignupDto extends createZodDto(SignupSchema) {}
