import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SocialProviderSchema } from './social-provider.schema';

// GET /users/me와 PATCH /users/me 200이 공유하는 조회 표현 — 같은 리소스, 변경 이유 동일(§9).
const UserProfileSchema = z.object({
  id: z.uuid(),
  // named component 단일 인스턴스 재사용(복제 시 duplicate-id 충돌).
  provider: SocialProviderSchema,
  // z.email() 아님 — 소셜 provider가 준 저장값이 RFC 위반이어도 조회가 500이 되면 안 된다
  // (@ZodResponse는 출력도 검증한다).
  email: z.string().nullable().meta({
    description: '소셜 프로필 이메일 — 미동의/미제공이면 null',
    example: 'user@kakao.com',
  }),
  nickname: z.string().meta({ description: '닉네임 — 전역 유니크', example: '풀멍' }),
  createdAt: z.iso.datetime().meta({ description: '가입 시각' }),
});

export class UserProfileDto extends createZodDto(UserProfileSchema) {}
