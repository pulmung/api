import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { sessions, users } from '../src/database/schema';
import { setupE2E } from './helpers/setup-e2e';

describe('UserProfile (e2e)', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;
  let meToken: string;
  let meId: string;

  beforeAll(async () => {
    ({ app, container, db, pool } = await setupE2E());
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await container.stop();
  });

  // 가입 = 유저 생성 + access token 확보. fakeVerifier가 accessToken을 providerUserId로 에코.
  const signup = async (accessToken: string, nickname: string) => {
    const res = await request(server)
      .post('/auth/signup')
      .send({ provider: 'kakao', platform: 'ios', accessToken, nickname });
    return (res.body as { accessToken: string }).accessToken;
  };

  // 닉네임이 전역 유니크 + PATCH가 그걸 변조하므로 매 테스트 유저를 리셋하고 새로 가입한다
  // (user-plant E2E처럼 beforeAll 가입을 유지하면 테스트 간 닉네임 상태가 샌다).
  beforeEach(async () => {
    await db.delete(sessions);
    await db.delete(users);
    meToken = await signup('user-profile-me', '프로필유저');
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.nickname, '프로필유저'));
    meId = row.id;
  });

  const getMe = async (token?: string) => {
    let req = request(server).get('/users/me');
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  const patchMe = async (payload: object, token?: string) => {
    let req = request(server).patch('/users/me');
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req.send(payload);
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  // GET/PATCH가 공유하는 조회 표현의 기대값 — email은 fakeVerifier 고정값.
  const meProfile = () => ({
    id: meId,
    provider: 'kakao',
    email: 'test@example.com',
    nickname: '프로필유저',
    createdAt: expect.stringMatching(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    ) as unknown,
  });

  describe('GET /users/me', () => {
    it('200: 내 프로필 조회 — 정확한 바디 매칭(providerUserId 미누출 증명)', async () => {
      const { status, body } = await getMe(meToken);
      expect(status).toBe(200);
      expect(body).toEqual(meProfile());
    });

    it('401: 토큰 없음', async () => {
      const { status, body } = await getMe();
      expect(status).toBe(401);
      expect(body.errorCode).toBe('UNAUTHENTICATED');
    });

    it('404: 행이 사라진 유저의 여전히 유효한(무상태) 토큰', async () => {
      await db.delete(sessions);
      await db.delete(users);
      const { status, body } = await getMe(meToken);
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_NOT_FOUND');
    });
  });

  describe('PATCH /users/me', () => {
    it('200: 닉네임 수정 — trim 반영, 응답 = GET 표현, DB 반영', async () => {
      const { status, body } = await patchMe(
        { nickname: '  새닉네임  ' },
        meToken,
      );
      expect(status).toBe(200);
      expect(body).toEqual({ ...meProfile(), nickname: '새닉네임' });

      const [row] = await db
        .select({ nickname: users.nickname })
        .from(users)
        .where(eq(users.id, meId));
      expect(row.nickname).toBe('새닉네임');
    });

    it('200: 현재 닉네임 그대로 no-op — 같은 행이라 유니크 충돌 아님', async () => {
      const { status, body } = await patchMe({ nickname: '프로필유저' }, meToken);
      expect(status).toBe(200);
      expect(body).toEqual(meProfile());
    });

    it.each([
      ['빈 패치 (no-op = 클라 버그)', {}],
      ['1자 (최소 미만)', { nickname: 'a' }],
      ['21자 (최대 초과)', { nickname: 'a'.repeat(21) }],
      ['null (notnull 필드라 해제 불가)', { nickname: null }],
    ])('400: %s', async (_, payload) => {
      const { status } = await patchMe(payload, meToken);
      expect(status).toBe(400);
    });

    it('401: 토큰 없음', async () => {
      const { status, body } = await patchMe({ nickname: '새닉네임' });
      expect(status).toBe(401);
      expect(body.errorCode).toBe('UNAUTHENTICATED');
    });

    it('404: 행이 사라진 유저의 여전히 유효한(무상태) 토큰', async () => {
      await db.delete(sessions);
      await db.delete(users);
      const { status, body } = await patchMe({ nickname: '새닉네임' }, meToken);
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_NOT_FOUND');
    });

    it('409: 남이 쓰는 닉네임 — 내 닉네임은 그대로', async () => {
      await signup('user-profile-other', '이웃유저');

      const { status, body } = await patchMe({ nickname: '이웃유저' }, meToken);
      expect(status).toBe(409);
      expect(body.errorCode).toBe('NICKNAME_TAKEN');

      const [row] = await db
        .select({ nickname: users.nickname })
        .from(users)
        .where(eq(users.id, meId));
      expect(row.nickname).toBe('프로필유저');
    });
  });
});
