import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { socialProviders } from '../../../../database/schema/user.schema';

/**
 * 회원가입 요청. provider 목록은 스키마의 socialProviders 단일 소스를 재사용.
 * nickname 은 유저 입력(필수) — provider 프로필에서 끌어오지 않는다.
 *
 * createZodDto: 이 Zod 스키마가 ① ZodValidationPipe 의 검증 기준,
 * ② 컴파일타임 타입, ③ OpenAPI 스펙(@nestjs/swagger) 소스가 된다.
 */
export const signupRequestSchema = z.object({
  provider: z.enum(socialProviders),
  accessToken: z.string().min(1),
  nickname: z.string().trim().min(1).max(30),
});

export class SignupRequestDto extends createZodDto(signupRequestSchema) {}
