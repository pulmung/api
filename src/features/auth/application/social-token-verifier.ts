import type { SocialProvider } from '../../../database/schema/user.schema';
import type { SocialProfile } from './social-profile';

/**
 * provider access_token 검증 포트(outbound).
 * 구현(어댑터)은 출처 검증을 신원 조회보다 먼저 수행해야 한다.
 */
export interface SocialTokenVerifier {
  readonly provider: SocialProvider;
  verify(accessToken: string): Promise<SocialProfile>;
}

export const SOCIAL_TOKEN_VERIFIERS = Symbol('SOCIAL_TOKEN_VERIFIERS');
