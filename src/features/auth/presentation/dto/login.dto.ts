import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { socialProviders } from '../../../user/domain/social-provider';
import { deviceFields } from './device.fields';

const LoginSchema = z.object({
  provider: z.enum(socialProviders),
  accessToken: z.string().min(1),
  ...deviceFields,
});

export class LoginDto extends createZodDto(LoginSchema) {}
