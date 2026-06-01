import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { Env } from '../../../config/env.validation';
import { SocialProfile } from '../application/social-profile';
import { SocialTokenVerifier } from '../application/social-token-verifier';
import { providerGet } from './provider-http';

const accessTokenInfoSchema = z.object({
  id: z.number(),
  app_id: z.number(),
});

const userMeSchema = z.object({
  id: z.number(),
  kakao_account: z
    .object({
      email: z.string().optional(),
    })
    .optional(),
});

const ACCESS_TOKEN_INFO_URL = 'https://kapi.kakao.com/v1/user/access_token_info';
const USER_ME_URL = 'https://kapi.kakao.com/v2/user/me';

@Injectable()
export class KakaoTokenVerifier implements SocialTokenVerifier {
  readonly provider = 'kakao' as const;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async verify(accessToken: string): Promise<SocialProfile> {
    const headers = { Authorization: `Bearer ${accessToken}` };

    // ① 출처 먼저 — access_token_info 의 app_id 검증
    const tokenInfo = await providerGet(ACCESS_TOKEN_INFO_URL, { headers });
    if (tokenInfo.status === 401) {
      throw new UnauthorizedException('invalid kakao access token');
    }
    if (tokenInfo.status !== 200) {
      throw new ServiceUnavailableException('kakao access_token_info error');
    }
    const info = accessTokenInfoSchema.safeParse(tokenInfo.body);
    if (!info.success) {
      throw new ServiceUnavailableException(
        'unexpected kakao token info response',
      );
    }
    const appId = this.config.get('KAKAO_APP_ID', { infer: true });
    if (info.data.app_id !== appId) {
      throw new UnauthorizedException('kakao token not issued for this app');
    }

    // ② 출처 통과 후에만 신원 조회 — user/me
    const me = await providerGet(USER_ME_URL, { headers });
    if (me.status === 401) {
      throw new UnauthorizedException('invalid kakao access token');
    }
    if (me.status !== 200) {
      throw new ServiceUnavailableException('kakao user/me error');
    }
    const user = userMeSchema.safeParse(me.body);
    if (!user.success) {
      throw new ServiceUnavailableException('unexpected kakao user response');
    }

    // 방어적 교차검증: 두 응답의 회원번호 일치
    if (user.data.id !== info.data.id) {
      throw new UnauthorizedException('kakao identity mismatch');
    }

    return {
      provider: this.provider,
      providerUserId: String(user.data.id),
      email: user.data.kakao_account?.email ?? null,
    };
  }
}
