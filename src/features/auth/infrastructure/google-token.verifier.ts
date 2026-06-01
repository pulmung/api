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

// tokeninfo 는 숫자 필드를 문자열로 준다 → exp 는 coerce.
const tokenInfoSchema = z.object({
  aud: z.string(),
  azp: z.string().optional(),
  sub: z.string(),
  email: z.string().optional(),
  exp: z.coerce.number(),
});

const TOKEN_INFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

@Injectable()
export class GoogleTokenVerifier implements SocialTokenVerifier {
  readonly provider = 'google' as const;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async verify(accessToken: string): Promise<SocialProfile> {
    const url = `${TOKEN_INFO_URL}?access_token=${encodeURIComponent(accessToken)}`;
    const { status, body } = await providerGet(url);

    // 무효/만료 토큰: tokeninfo 는 400 → 우리 관점에선 인증 실패(401)
    if (status === 400 || status === 401) {
      throw new UnauthorizedException('invalid google access token');
    }
    if (status !== 200) {
      throw new ServiceUnavailableException('google tokeninfo error');
    }

    const parsed = tokenInfoSchema.safeParse(body);
    if (!parsed.success) {
      throw new ServiceUnavailableException(
        'unexpected google tokeninfo response',
      );
    }
    const info = parsed.data;

    // ① 출처 먼저: aud(또는 azp) ∈ 우리 OAuth client id 집합
    const clientIds = this.config.get('GOOGLE_CLIENT_IDS', { infer: true });
    const matched =
      clientIds.includes(info.aud) ||
      (info.azp !== undefined && clientIds.includes(info.azp));
    if (!matched) {
      throw new UnauthorizedException('google token not issued for this app');
    }

    // ② 만료
    if (info.exp * 1000 <= Date.now()) {
      throw new UnauthorizedException('google access token expired');
    }

    // ③ 신원
    return {
      provider: this.provider,
      providerUserId: info.sub,
      email: info.email ?? null,
    };
  }
}
