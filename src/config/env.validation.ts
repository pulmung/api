import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),

  // ── 소셜 인증 (auth feature) ──
  // 구글 OAuth Client ID 집합. 콤마구분 문자열 → string[]. 웹/Android/iOS 플랫폼별 client_id를 전부 나열.
  GOOGLE_CLIENT_IDS: z
    .string()
    .min(1)
    .transform((s) =>
      s
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0),
    )
    .refine((a) => a.length > 0, 'at least one google client id required'),
  // 카카오 앱 ID. access_token_info 의 app_id(숫자)와 number===number 로 비교.
  KAKAO_APP_ID: z.coerce.number().int().positive(),

  // ── 자체 JWT ── (현재 access 토큰만. refresh 는 추후)
  JWT_ACCESS_SECRET: z.string(),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),

  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(0).default(30),

  TRUST_PROXY_HOPS: z.coerce.number().int().default(1),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`❌ 환경변수 검증 실패:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
