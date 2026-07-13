import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { sessions } from '../src/database/schema';
import { users } from '../src/database/schema';
import { setupE2E } from './helpers/setup-e2e';
import { REFRESH_REUSE_GRACE_MS } from '../src/features/auth/application/refresh-session.usecase';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;

  beforeAll(async () => {
    ({ app, container, db, pool } = await setupE2E());
    server = app.getHttpServer() as Server;
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
    await container.stop();
  });
  beforeEach(async () => {
    await db.delete(sessions);
    await db.delete(users);
  });

  const base = { provider: 'kakao', platform: 'ios' };
  const post = async (path: string, payload: object) => {
    const res = await request(server).post(path).send(payload);
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  // 가입 = 토큰 발급. 테스트용 유저 1명 만들고 refreshToken 반환.
  const register = async (accessToken = 'user-1', nickname = '풀멍') => {
    const { body } = await post('/auth/signup', {
      ...base,
      accessToken,
      nickname,
    });
    return body.refreshToken as string;
  };

  const sessionIdOf = (refreshToken: string) => refreshToken.split('.')[0];

  // grace 만료 시뮬레이션: rotated_at을 과거로 되감는다 (실시간 대기 X)
  const rewindRotatedAt = async (refreshToken: string, msAgo: number) => {
    await db
      .update(sessions)
      .set({ rotatedAt: new Date(Date.now() - msAgo) })
      .where(eq(sessions.id, sessionIdOf(refreshToken)));
  };

  describe('POST /auth/signup', () => {
    it('201: 가입 성공 -> 토큰 발급', async () => {
      const { status, body } = await post('/auth/signup', {
        ...base,
        accessToken: 'user-1',
        nickname: '풀멍',
      });
      expect(status).toBe(201);
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();
    });

    it('409: 이미 가입된 소셜 계정', async () => {
      await register('user-1', '풀멍');
      const { status, body } = await post('/auth/signup', {
        ...base,
        accessToken: 'user-1',
        nickname: '다른닉',
      });
      expect(status).toBe(409);
      expect(body.errorCode).toBe('USER_ALREADY_REGISTERED');
    });

    it('409: 닉네임 중복', async () => {
      await register('user-1', '풀멍');
      const { status, body } = await post('/auth/signup', {
        ...base,
        accessToken: 'user-2',
        nickname: '풀멍',
      });

      expect(status).toBe(409);
      expect(body.errorCode).toBe('NICKNAME_TAKEN');
    });

    it('400: 닉네임 형식 위반', async () => {
      const { status } = await post('/auth/signup', {
        ...base,
        accessToken: 'user-1',
        nickname: 'a',
      });
      expect(status).toBe(400);
    });
  });

  describe('POST /auth/login', () => {
    it('200: 가입된 유저 -> 토큰 발급', async () => {
      await register('user-1', '풀멍');
      const { status, body } = await post('/auth/login', {
        ...base,
        accessToken: 'user-1',
      });
      expect(status).toBe(200);
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();
    });

    it('404: 미가입 유저', async () => {
      const { status, body } = await post('/auth/login', {
        ...base,
        accessToken: 'ghost',
      });
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_NOT_FOUND');
    });
  });

  describe('POST /auth/refresh', () => {
    it('200: 회전 -> 새 토큰 발급(옛 토큰과 다름)', async () => {
      const rtA = await register();
      const { status, body } = await post('/auth/refresh', {
        refreshToken: rtA,
      });
      expect(status).toBe(200);
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).not.toBe(rtA);
    });

    it('401: grace 만료 후 옛 토큰 재사용 -> 세션 전체 무효화', async () => {
      const rtA = await register();
      const rotated = await post('/auth/refresh', { refreshToken: rtA });
      const rtB = rotated.body.refreshToken as string;

      // grace window를 지난 시점으로 되감기
      await rewindRotatedAt(rtA, REFRESH_REUSE_GRACE_MS + 1_000);

      // 옛 토큰(rtA) 재사용 = 탈취 의심 -> 401
      const reuse = await post('/auth/refresh', { refreshToken: rtA });
      expect(reuse.status).toBe(401);
      expect(reuse.body.errorCode).toBe('INVALID_REFRESH_TOKEN');

      // 정상 최신 토큰(rtB)까지 함께 죽는다 (세션 통째 revoke)
      const after = await post('/auth/refresh', { refreshToken: rtB });
      expect(after.status).toBe(401);
      expect(after.body.errorCode).toBe('INVALID_REFRESH_TOKEN');

      // DB에도 세션이 남지 않는다
      const rows = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionIdOf(rtA)));
      expect(rows).toHaveLength(0);
    });

    it('200: grace window 내 옛 토큰 재사용(멀티탭 레이스) -> 새 토큰 발급', async () => {
      const rtA = await register();
      const first = await post('/auth/refresh', { refreshToken: rtA });
      const rtB = first.body.refreshToken as string;

      const { status, body } = await post('/auth/refresh', {
        refreshToken: rtA,
      });
      expect(status).toBe(200);
      expect(body.refreshToken).toBeDefined();
      expect(body.refreshToken).not.toBe(rtA);
      expect(body.refreshToken).not.toBe(rtB);

      // grace로 받은 최신 토큰은 정상 사용 가능
      const next = await post('/auth/refresh', {
        refreshToken: body.refreshToken as string,
      });
      expect(next.status).toBe(200);
    });

    it('200: grace 내 같은 옛 토큰 N회 재사용도 모두 통과 (prev pin)', async () => {
      const rtA = await register();
      await post('/auth/refresh', { refreshToken: rtA }); // 정상 회전 -> prev=hash(A) pin

      for (let i = 0; i < 3; i++) {
        const { status } = await post('/auth/refresh', { refreshToken: rtA });
        expect(status).toBe(200); // prev가 매번 바뀌면 2번째부터 nuke — pin 덕에 전부 통과
      }
    });

    it('401: grace 회전으로 대체된 중간 토큰 제시 -> 세션 전체 무효화', async () => {
      const rtA = await register();
      const first = await post('/auth/refresh', { refreshToken: rtA }); // cur=B, prev=A
      const rtB = first.body.refreshToken as string;
      await post('/auth/refresh', { refreshToken: rtA }); // grace: cur=C, prev=A — B는 고아

      const { status, body } = await post('/auth/refresh', {
        refreshToken: rtB,
      });
      expect(status).toBe(401);
      expect(body.errorCode).toBe('INVALID_REFRESH_TOKEN');

      const rows = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionIdOf(rtA)));
      expect(rows).toHaveLength(0);
    });

    it('401: 세션 만료 후에는 grace 내 옛 토큰도 거부', async () => {
      const rtA = await register();
      await post('/auth/refresh', { refreshToken: rtA }); // prev=hash(A), grace 진행 중
      await db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(sessions.id, sessionIdOf(rtA)));

      const { status } = await post('/auth/refresh', { refreshToken: rtA });
      expect(status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('204 -> 이후 같은 토큰 refresh는 401', async () => {
      const rt = await register();

      const { status } = await post('/auth/logout', { refreshToken: rt });
      expect(status).toBe(204);

      const res = await post('/auth/refresh', { refreshToken: rt });
      expect(res.status).toBe(401);
    });
  });
});
