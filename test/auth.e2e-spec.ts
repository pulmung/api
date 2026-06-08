import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { sessions } from '../src/database/schema/auth.schema';
import { users } from '../src/database/schema';
import { setupE2E } from './helpers/setup-e2e';
import { Server } from 'node:http';
import { Pool } from 'pg';

describe('Auth signup (e2e)', () => {
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

  const signup = async (payload: object) => {
    const res = await request(server).post('/auth/signup').send(payload);
    return { status: res.status, body: res.body as Record<string, unknown> };
  };
  const base = { provider: 'kakao', platform: 'ios' };

  it('201: 가입 성공 -> 토큰 발급', async () => {
    const { status, body } = await signup({
      ...base,
      accessToken: 'user-1',
      nickname: '식집사',
    });
    expect(status).toBe(201);
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();
  });

  it('409: 이미 가입된 소셜 계정', async () => {
    await signup({ ...base, accessToken: 'user-1', nickname: '식집사' });
    const res = await signup({
      ...base,
      accessToken: 'user-1',
      nickname: '다른닉',
    });
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('USER_ALREADY_REGISTERED');
  });

  it('409: 닉네임 중복', async () => {
    await signup({ ...base, accessToken: 'user-1', nickname: '식집사' });
    const res = await signup({
      ...base,
      accessToken: 'user-2',
      nickname: '식집사',
    });
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('NICKNAME_TAKEN');
  });

  it('400: 닉네임 형식 위반', async () => {
    const res = await signup({ ...base, accessToken: 'user-1', nickname: 'a' });
    expect(res.status).toBe(400);
  });
});
