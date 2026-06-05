import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { ConfigService } from '@nestjs/config';
import { SocialIdentityVerifier } from './identity.verifier';
import { InvalidSocialTokenError } from '../../domain/auth.error';
import { Env } from '../../../../config/env.validation';

const GOOGLE_CLIENT_ID = 'my-google-client-id';
const KAKAO_APP_ID = 12345;

// ConfigService는 부분 mock으로 충분 — verifier가 구현 직접 주입이라 TestingModule 불필요(new로 바로)
const config = {
  get: (key: string) =>
    key === 'GOOGLE_CLIENT_IDS' ? [GOOGLE_CLIENT_ID] : KAKAO_APP_ID,
} as unknown as ConfigService<Env, true>;

const verifier = new SocialIdentityVerifier(config);

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('SocialIdentityVerifier - google', () => {
  const tokeninfo = (body: JsonBodyType, status?: number) =>
    server.use(
      http.get('https://oauth2.googleapis.com/tokeninfo', () =>
        status ? new HttpResponse(null, { status }) : HttpResponse.json(body),
      ),
    );

  it('유효 토큰 + aud 일치 -> 공통 신원으로 정규화', async () => {
    tokeninfo({ aud: GOOGLE_CLIENT_ID, sub: '108', email: 'u@gmail.com' });
    const identity = await verifier.verify({
      provider: 'google',
      accessToken: 'tok',
    });
    expect(identity).toEqual({
      provider: 'google',
      providerUserId: '108',
      email: 'u@gmail.com',
    });
  });

  it('aud 불일치(공격자 앱 토큰) -> InvalidSocialTokenError', async () => {
    tokeninfo({ aud: 'attacker-app', sub: '108', email: 'u@gmail.com' });
    await expect(
      verifier.verify({ provider: 'google', accessToken: 'tok' }),
    ).rejects.toThrow(InvalidSocialTokenError);
  });

  it('만료,무효 토큰 (4xx) -> InvalidSocialTokenError', async () => {
    tokeninfo(null, 400);
    await expect(
      verifier.verify({ provider: 'google', accessToken: 'tok' }),
    ).rejects.toThrow(InvalidSocialTokenError);
  });

  it('email 미동의 -> email null', async () => {
    tokeninfo({ aud: GOOGLE_CLIENT_ID, sub: '108' });
    const identity = await verifier.verify({
      provider: 'google',
      accessToken: 'tok',
    });
    expect(identity.email).toBeNull();
  });
});

describe('SocialIdentityVerifier - kakao', () => {
  const mockKakao = (o: {
    info?: JsonBodyType;
    infoStatus?: number;
    me?: JsonBodyType;
    meStatus?: number;
  }) =>
    server.use(
      http.get('https://kapi.kakao.com/v1/user/access_token_info', () =>
        o.infoStatus
          ? new HttpResponse(null, { status: o.infoStatus })
          : HttpResponse.json(o.info),
      ),
      http.get('https://kapi.kakao.com/v2/user/me', () =>
        o.meStatus
          ? new HttpResponse(null, { status: o.meStatus })
          : HttpResponse.json(o.me),
      ),
    );

  it('유효 토큰 + app_id 일치 -> 정규화 (id number->string)', async () => {
    mockKakao({
      info: { app_id: KAKAO_APP_ID },
      me: { id: 4728944876, kakao_account: { email: 'u@kakao.com' } },
    });
    const identity = await verifier.verify({
      provider: 'kakao',
      accessToken: 'tok',
    });
    expect(identity).toEqual({
      provider: 'kakao',
      providerUserId: '4728944876',
      email: 'u@kakao.com',
    });
  });

  it('app_id 불일치 -> InvalidSocialTokenError', async () => {
    mockKakao({ info: { app_id: 99999 }, me: { id: 1 } });
    await expect(
      verifier.verify({ provider: 'kakao', accessToken: 'tok' }),
    ).rejects.toThrow(InvalidSocialTokenError);
  });

  it('access_token_info 4xx -> InvalidSocialTokenError (출처검증 전 차단)', async () => {
    mockKakao({ infoStatus: 401 });
    await expect(
      verifier.verify({ provider: 'kakao', accessToken: 'tok' }),
    ).rejects.toThrow(InvalidSocialTokenError);
  });

  it('user/me 4xx -> InvalidSocialTokenError', async () => {
    mockKakao({ info: { app_id: KAKAO_APP_ID }, meStatus: 401 });
    await expect(
      verifier.verify({ provider: 'kakao', accessToken: 'tok' }),
    ).rejects.toThrow(InvalidSocialTokenError);
  });

  it('이메일 미동의(kakao_account 없음) -> email null', async () => {
    mockKakao({ info: { app_id: KAKAO_APP_ID }, me: { id: 1 } });
    const identity = await verifier.verify({
      provider: 'kakao',
      accessToken: 'tok',
    });
    expect(identity.email).toBeNull();
  });
});
