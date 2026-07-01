import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { sessions, users } from '../src/database/schema';
import { setupE2E } from './helpers/setup-e2e';
import { CurrentUser } from '../src/common/auth/current-user.decorator';
import { Authenticated } from '../src/features/auth/presentation/authenticated.decorator';
import { OptionalAuth } from '../src/features/auth/presentation/optional-auth.decorator';
import type { AuthUser } from '../src/common/auth/auth-user';

// 테스트 전용 보호 라우트 - 가드를 feature와 무관하게 검증하기 위한 fixture
@Controller('__probe__')
class ProbeController {
  @Authenticated()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @OptionalAuth()
  @Get('feed')
  feed(@CurrentUser() user?: AuthUser) {
    return { user: user ?? null };
  }
}

describe('JwtAuthGuard (e2e)', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;

  beforeAll(async () => {
    ({ app, container, db, pool } = await setupE2E([ProbeController]));
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

  const SECRET = 'test-secret'; // setup-e2e.ts가 박는 JWT_ACCESS_SECRET와 동일

  // 위조 토큰 제작기 (진짜 서명 - 다른 secret / 다른 alg / 만료)
  const forge = (secret: string, options?: JwtSignOptions) =>
    new JwtService({ secret }).sign({ sub: 'forged-user' }, options);

  // 앱이 실제로 발급한 access token
  const realToken = async (accessToken = 'user-1', nickname = '풀멍') => {
    const res = await request(server)
      .post('/auth/signup')
      .send({ provider: 'kakao', platform: 'ios', accessToken, nickname });
    return (res.body as { accessToken: string }).accessToken;
  };

  const get = async (path: string, token?: string) => {
    let req = request(server).get(path);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  describe('보호 라우트 GET /__probe__/me', () => {
    it('앱 발급 토큰 -> 200 + req.user(id)', async () => {
      const { status, body } = await get('/__probe__/me', await realToken());
      expect(status).toBe(200);
      expect(typeof body.id).toBe('string');
    });

    it('토큰 없음 -> 401 + errorCode UNAUTHENTICATED (필터 직렬화까지)', async () => {
      const { status, body } = await get('/__probe__/me');
      expect(status).toBe(401);
      expect(body).toMatchObject({
        statusCode: 401,
        errorCode: 'UNAUTHENTICATED',
      });
    });

    it('다른 secret 서명 -> 401 (서명을 실제로 검증)', async () => {
      const { status } = await get('/__probe__/me', forge('wrong-secret'));
      expect(status).toBe(401);
    });

    it('secret은 맞지만 HS384 서명 -> 401 (HS256 핀이 진짜 먹는지)', async () => {
      const { status } = await get(
        '/__probe__/me',
        forge(SECRET, { algorithm: 'HS384' }),
      );
      expect(status).toBe(401);
    });

    it('만료 토큰 -> 401', async () => {
      const { status } = await get(
        '/__probe__/me',
        forge(SECRET, { expiresIn: '-10s' }),
      );
      expect(status).toBe(401);
    });
  });

  describe('선택적 인증 GET /__probe__/feed', () => {
    it('토큰 없음 -> 200 익명(user null)', async () => {
      const { status, body } = await get('/__probe__/feed');
      expect(status).toBe(200);
      expect(body).toEqual({ user: null });
    });

    it('유효 토큰 -> 200 + user(id)', async () => {
      const { status, body } = await get('/__probe__/feed', await realToken());
      expect(status).toBe(200);
      const user = body.user as { id: unknown };
      expect(typeof user.id).toBe('string');
    });

    it('깨진 토큰을 보내면 -> 401 (보냈으면 유효해야)', async () => {
      const { status } = await get('/__probe__/feed', forge('wrong-secret'));
      expect(status).toBe(401);
    });
  });
});
