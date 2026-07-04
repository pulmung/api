import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { plants, users } from '../src/database/schema';
import { setupE2E, FakeFileStorage } from './helpers/setup-e2e';

describe('Plant (e2e)', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;
  let fakeStorage: FakeFileStorage;
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    ({ app, container, db, pool, fakeStorage } = await setupE2E());
    server = app.getHttpServer() as Server;

    // 실제 가입으로 진짜 access token 확보 (verifier는 fake — 아무 accessToken이나 통과)
    const res = await request(server).post('/auth/signup').send({
      provider: 'kakao',
      platform: 'ios',
      accessToken: 'plant-e2e-user',
      nickname: '식집사',
    });
    accessToken = (res.body as { accessToken: string }).accessToken;

    const [user] = await db.select({ id: users.id }).from(users);
    userId = user.id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    // users는 지우지 않는다 — beforeAll에서 가입한 토큰 유저가 살아있어야 createdById FK가 성립.
    await db.delete(plants);
    fakeStorage.missingKeys.clear();
  });

  const postPlants = async (payload: object, token?: string) => {
    let req = request(server).post('/plants');
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req.send(payload);
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  const validPayload = {
    name: '몬스테라 알보',
    images: [
      {
        key: 'plant-image/0198c5b2-2f74-7abc-8def-000000000001.jpg',
        width: 800,
        height: 600,
      },
      { key: 'plant-image/0198c5b2-2f74-7abc-8def-000000000002.webp' },
    ],
    genus: 'Monstera',
    species: 'deliciosa',
    category: '관엽',
  };

  it('201: 생성 — 응답에 id/이미지/메타/createdAt', async () => {
    const { status, body } = await postPlants(validPayload, accessToken);

    expect(status).toBe(201);
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.name).toBe('몬스테라 알보');
    expect(body.images).toEqual(validPayload.images);
    expect(body.genus).toBe('Monstera');
    expect(body.species).toBe('deliciosa');
    expect(body.category).toBe('관엽');
    expect(Number.isNaN(Date.parse(body.createdAt as string))).toBe(false);
  });

  it('201: DB에 jsonb로 왕복 저장된다 (images 배열 + createdById)', async () => {
    const { body } = await postPlants(validPayload, accessToken);

    const [row] = await db
      .select()
      .from(plants)
      .where(eq(plants.id, body.id as string));
    expect(row.images).toEqual(validPayload.images);
    expect(row.createdById).toBe(userId);
  });

  it('201: 최소 payload (이름 + 이미지 1장) — 메타는 null', async () => {
    const { status, body } = await postPlants(
      { name: '이름만', images: [validPayload.images[0]] },
      accessToken,
    );

    expect(status).toBe(201);
    expect(body.genus).toBeNull();
    expect(body.species).toBeNull();
    expect(body.category).toBeNull();
  });

  it('401: 토큰 없음', async () => {
    const { status, body } = await postPlants(validPayload);
    expect(status).toBe(401);
    expect(body.errorCode).toBe('UNAUTHENTICATED');
  });

  it('400: images 빈 배열 (Zod)', async () => {
    const { status } = await postPlants(
      { ...validPayload, images: [] },
      accessToken,
    );
    expect(status).toBe(400);
  });

  it('400: name 공백뿐 (Zod)', async () => {
    const { status } = await postPlants(
      { ...validPayload, name: '   ' },
      accessToken,
    );
    expect(status).toBe(400);
  });

  it('409: 같은 이름 재등록 (공유 카탈로그 중복 금지)', async () => {
    await postPlants(validPayload, accessToken);
    const { status, body } = await postPlants(validPayload, accessToken);

    expect(status).toBe(409);
    expect(body.errorCode).toBe('PLANT_NAME_TAKEN');
  });

  it('422: 업로드되지 않은 key 첨부 (head 실존 검증)', async () => {
    const key = 'plant-image/0198c5b2-2f74-7abc-8def-00000000dead.jpg';
    fakeStorage.missingKeys.add(key);

    const { status, body } = await postPlants(
      { ...validPayload, images: [{ key }] },
      accessToken,
    );

    expect(status).toBe(422);
    expect(body.errorCode).toBe('PLANT_IMAGE_NOT_UPLOADED');
  });

  it('422: 다른 purpose의 key prefix (Zod 통과 후 도메인이 거른다)', async () => {
    const { status, body } = await postPlants(
      { ...validPayload, images: [{ key: 'chat-file/0198.jpg' }] },
      accessToken,
    );

    expect(status).toBe(422);
    expect(body.errorCode).toBe('INVALID_PLANT_IMAGES');
  });
});
