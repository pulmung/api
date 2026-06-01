import type { SocialProvider } from '../../../database/schema/user.schema';

/** provider 토큰 검증 결과의 정규화 형태. provider별 차이를 흡수한다. */
export interface SocialProfile {
  provider: SocialProvider;
  providerUserId: string;
  email: string | null;
}
