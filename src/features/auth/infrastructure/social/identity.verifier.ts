import { Injectable } from '@nestjs/common';
import { SocialProvider } from '../../../user/domain/social-provider';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../../../config/env.validation';
import { InvalidSocialTokenError } from '../../domain/auth.error';
import { z } from 'zod';

const GoogleTokenInfo = z.object({
  aud: z.string(),
  sub: z.string(),
  email: z.string().optional(),
});

const KakaoTokenInfo = z.object({ app_id: z.number() });
const KakaoUserInfo = z.object({
  id: z.number(),
  kakao_account: z
    .object({
      email: z.string().optional(),
    })
    .optional(),
});

@Injectable()
export class SocialIdentityVerifier {
  constructor(private readonly config: ConfigService<Env, true>) {}
  async verify(input: { provider: SocialProvider; accessToken: string }) {
    switch (input.provider) {
      case 'google':
        return this.verifyGoogle(input.accessToken);
      case 'kakao':
        return this.verifyKakao(input.accessToken);
    }
  }

  private async verifyGoogle(accessToken: string) {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) throw new InvalidSocialTokenError();

    const raw: unknown = await res.json();
    const data = GoogleTokenInfo.parse(raw);

    const clientIds = this.config.get('GOOGLE_CLIENT_IDS', { infer: true });
    if (!clientIds.includes(data.aud)) throw new InvalidSocialTokenError();

    return {
      provider: 'google' as const,
      providerUserId: data.sub,
      email: data.email ?? null,
    };
  }

  private async verifyKakao(accessToken: string) {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
    };

    const infoRes = await fetch(
      'https://kapi.kakao.com/v1/user/access_token_info',
      {
        headers,
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!infoRes.ok) throw new InvalidSocialTokenError();
    const infoRaw: unknown = await infoRes.json();
    const info = KakaoTokenInfo.parse(infoRaw);

    const appId = this.config.get('KAKAO_APP_ID', { infer: true });
    if (info.app_id !== appId) throw new InvalidSocialTokenError();

    const meRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!meRes.ok) throw new InvalidSocialTokenError();
    const meRaw: unknown = await meRes.json();
    const me = KakaoUserInfo.parse(meRaw);

    return {
      provider: 'kakao' as const,
      providerUserId: String(me.id),
      email: me.kakao_account?.email ?? null,
    };
  }
}
