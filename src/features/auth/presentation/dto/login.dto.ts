import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SocialProviderSchema } from '../../../user/presentation/shared/social-provider.schema';
import { deviceFields } from '../shared/device.fields';

const LoginSchema = z.object({
  provider: SocialProviderSchema,
  accessToken: z.string().min(1),
  ...deviceFields,
});

export class LoginDto extends createZodDto(LoginSchema) {}
