import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { socialProviders } from '../../../../database/schema/user.schema';
import { UserEntity } from '../../domain/user';

/** 회원가입 응답. providerUserId·내부 타임스탬프는 노출하지 않는다. */
export const signupResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    provider: z.enum(socialProviders),
    nickname: z.string(),
    email: z.string().nullable(),
  }),
  accessToken: z.string(),
});

export class SignupResponseDto extends createZodDto(signupResponseSchema) {}

type SignupResponse = z.infer<typeof signupResponseSchema>;

export function toSignupResponse(
  user: UserEntity,
  accessToken: string,
): SignupResponse {
  return {
    user: {
      id: user.id,
      provider: user.provider,
      nickname: user.nickname,
      email: user.email,
    },
    accessToken,
  };
}
