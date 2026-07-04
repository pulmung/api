import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { setupE2E } from './helpers/setup-e2e';

describe('File (e2e)', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let server: Server;
  let pool: Pool;
  let accessToken: string;

  beforeAll(async () => {
    ({ app, container, pool } = await setupE2E());
    server = app.getHttpServer() as Server;

    // 실제 가입으로 진짜 access token 확보 (verifier는 fake — 아무 accessToken이나 통과)
    const res = await request(server).post('/auth/signup').send({
      provider: 'kakao',
      platform: 'ios',
      accessToken: 'file-e2e-user',
      nickname: '파일러',
    });
    accessToken = (res.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await container.stop();
  });

  const postFiles = async (payload: object, token?: string) => {
    let req = request(server).post('/files');
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req.send(payload);
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  const validPayload = {
    purpose: 'plant-image',
    contentType: 'image/jpeg',
    size: 1234,
  };

  it('201: presign 발급 — key는 불투명 uuid, upload에 url/fields/expiresAt', async () => {
    const { status, body } = await postFiles(validPayload, accessToken);

    expect(status).toBe(201);
    expect(body.key).toMatch(/^plant-image\/[0-9a-f-]{36}\.(jpg|png|webp)$/);

    const upload = body.upload as {
      url: string;
      fields: Record<string, string>;
      expiresAt: string;
    };
    expect(upload.url).toContain('test-bucket');
    expect(upload.fields.key).toBe(body.key);
    expect(Number.isNaN(Date.parse(upload.expiresAt))).toBe(false);
  });

  it('201: size 없이도 발급된다 (크기 강제는 S3 policy 몫)', async () => {
    const { status } = await postFiles(
      { purpose: 'plant-image', contentType: 'image/webp' },
      accessToken,
    );
    expect(status).toBe(201);
  });

  it('401: 토큰 없음', async () => {
    const { status, body } = await postFiles(validPayload);
    expect(status).toBe(401);
    expect(body.errorCode).toBe('UNAUTHENTICATED');
  });

  it('400: 알 수 없는 purpose (Zod)', async () => {
    const { status } = await postFiles(
      { ...validPayload, purpose: 'unknown-purpose' },
      accessToken,
    );
    expect(status).toBe(400);
  });

  it('422: 허용되지 않은 contentType', async () => {
    const { status, body } = await postFiles(
      { ...validPayload, contentType: 'image/gif' },
      accessToken,
    );
    expect(status).toBe(422);
    expect(body.errorCode).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('422: 선언된 size가 정책 초과', async () => {
    const { status, body } = await postFiles(
      { ...validPayload, size: 10 * 1024 * 1024 + 1 },
      accessToken,
    );
    expect(status).toBe(422);
    expect(body.errorCode).toBe('FILE_TOO_LARGE');
  });
});
