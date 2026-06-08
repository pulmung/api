import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export class AuthTokensDto extends createZodDto(AuthTokensSchema) {}
