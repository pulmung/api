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
  const register = async (accessToken = 'user-1', nickname = '식집사') => {
    const { body } = await post('/auth/signup', {
      ...base,
      accessToken,
      nickname,
    });
    return body.refreshToken as string;
  };

  const sessionIdOf = (refreshToken: string) => refreshToken.split('.')[0];

  describe('POST /auth/signup', () => {
    it('201: 가입 성공 -> 토큰 발급', async () => {
      const { status, body } = await post('/auth/signup', {
        ...base,
        accessToken: 'user-1',
        nickname: '식집사',
      });
      expect(status).toBe(201);
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();
    });

    it('409: 이미 가입된 소셜 계정', async () => {
      await register('user-1', '식집사');
      const { status, body } = await post('/auth/signup', {
        ...base,
        accessToken: 'user-1',
        nickname: '다른닉',
      });
      expect(status).toBe(409);
      expect(body.errorCode).toBe('USER_ALREADY_REGISTERED');
    });

    it('409: 닉네임 중복', async () => {
      await register('user-1', '식집사');
      const { status, body } = await post('/auth/signup', {
        ...base,
        accessToken: 'user-2',
        nickname: '식집사',
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
      await register('user-1', '식집사');
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

    it('401: 회전 후 옛 토큰 재사용 -> 세션 전체 무효화', async () => {
      const rtA = await register();
      const rotated = await post('/auth/refresh', { refreshToken: rtA });
      const rtB = rotated.body.refreshToken as string;

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
