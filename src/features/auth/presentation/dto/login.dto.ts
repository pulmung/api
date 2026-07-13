import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SocialProviderSchema } from '../../../user/presentation/dto/social-provider.schema';
import { deviceFields } from './device.fields';

const LoginSchema = z.object({
  provider: SocialProviderSchema,
  accessToken: z.string().min(1),
  ...deviceFields,
});

export class LoginDto extends createZodDto(LoginSchema) {}
