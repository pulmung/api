import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { plants, userPlants, users } from '../src/database/schema';
import { setupE2E, FakeFileStorage } from './helpers/setup-e2e';
import { TEST_FILE_BASE_URL } from './helpers/test-env';

describe('UserPlant (e2e)', () => {
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
      accessToken: 'user-plant-e2e-user',
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
    // users는 지우지 않는다 — beforeAll에서 가입한 토큰 유저가 살아있어야 ownerId FK가 성립.
    // userPlants → plants 순서 (개체가 카탈로그를 참조).
    await db.delete(userPlants);
    await db.delete(plants);
    fakeStorage.missingKeys.clear();
  });

  const postUserPlants = async (payload: object, token?: string) => {
    let req = request(server).post('/user-plants');
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req.send(payload);
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  // 카탈로그 fixture — plantId 연결 테스트용 (beforeEach가 지우므로 테스트 안에서 생성).
  const insertCatalogPlant = async () => {
    const [row] = await db
      .insert(plants)
      .values({
        name: '몬스테라 알보',
        images: [{ key: 'plant-image/0198c5b2-2f74-7abc-8def-0000000000ca.jpg' }],
      })
      .returning({ id: plants.id, name: plants.name });
    return row;
  };

  const imageKeys = [
    'user-plant-image/0198c5b2-2f74-7abc-8def-000000000001.jpg',
    'user-plant-image/0198c5b2-2f74-7abc-8def-000000000002.webp',
  ];

  it('201: 풀 payload 생성 — 응답은 조회 표현 (카탈로그 중첩 + 이미지 url + adoptedAt 문자열 왕복)', async () => {
    const catalog = await insertCatalogPlant();

    const { status, body } = await postUserPlants(
      {
        name: '초록이',
        plantId: catalog.id,
        images: [
          { key: imageKeys[0], width: 800, height: 600 },
          { key: imageKeys[1] },
        ],
        adoptedAt: '2026-05-01',
        memo: '거실 창가',
      },
      accessToken,
    );

    expect(status).toBe(201);
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.name).toBe('초록이');
    // key(불투명)가 아니라 조합된 읽기 URL — toEqual 정확 일치라 key 미노출까지 보장.
    expect(body.images).toEqual([
      { url: `${TEST_FILE_BASE_URL}/${imageKeys[0]}`, width: 800, height: 600 },
      { url: `${TEST_FILE_BASE_URL}/${imageKeys[1]}` },
    ]);
    // 연결된 카탈로그는 중첩 요약으로 — 개체 name(애칭)과 키 충돌 없음.
    expect(body.plant).toEqual({ id: catalog.id, name: '몬스테라 알보' });
    // date 컬럼 string 모드 회귀 테스트 겸 — 'YYYY-MM-DD' 그대로 왕복.
    expect(body.adoptedAt).toBe('2026-05-01');
    expect(body.memo).toBe('거실 창가');
    expect(Number.isNaN(Date.parse(body.createdAt as string))).toBe(false);
  });

  it('201: DB에 왕복 저장된다 (ownerId·plantId·images jsonb)', async () => {
    const catalog = await insertCatalogPlant();
    const images = [{ key: imageKeys[0], width: 800, height: 600 }];

    const { body } = await postUserPlants(
      { name: '초록이', plantId: catalog.id, images },
      accessToken,
    );

    const [row] = await db
      .select()
      .from(userPlants)
      .where(eq(userPlants.id, body.id as string));
    expect(row.ownerId).toBe(userId);
    expect(row.plantId).toBe(catalog.id);
    expect(row.images).toEqual(images);
  });

  it('201: 최소 payload (이름만) — 미동정·사진 없음 등록 허용', async () => {
    const { status, body } = await postUserPlants(
      { name: '이름만' },
      accessToken,
    );

    expect(status).toBe(201);
    expect(body.images).toEqual([]);
    expect(body.plant).toBeNull();
    expect(body.adoptedAt).toBeNull();
    expect(body.memo).toBeNull();
  });

  it('401: 토큰 없음', async () => {
    const { status, body } = await postUserPlants({ name: '초록이' });
    expect(status).toBe(401);
    expect(body.errorCode).toBe('UNAUTHENTICATED');
  });

  it('400: plantId가 uuid가 아님 (Zod)', async () => {
    const { status } = await postUserPlants(
      { name: '초록이', plantId: 'not-a-uuid' },
      accessToken,
    );
    expect(status).toBe(400);
  });

  it('422: 존재하지 않는 카탈로그 참조 (FK 23503 → 도메인 예외)', async () => {
    const { status, body } = await postUserPlants(
      { name: '초록이', plantId: uuidv7() },
      accessToken,
    );

    expect(status).toBe(422);
    expect(body.errorCode).toBe('REFERENCED_PLANT_NOT_FOUND');
  });

  it('422: 업로드되지 않은 key 첨부 (head 실존 검증)', async () => {
    const key = 'user-plant-image/0198c5b2-2f74-7abc-8def-00000000dead.jpg';
    fakeStorage.missingKeys.add(key);

    const { status, body } = await postUserPlants(
      { name: '초록이', images: [{ key }] },
      accessToken,
    );

    expect(status).toBe(422);
    expect(body.errorCode).toBe('USER_PLANT_IMAGE_NOT_UPLOADED');
  });

  it('422: 카탈로그 purpose의 key prefix (Zod 통과 후 도메인이 거른다)', async () => {
    const { status, body } = await postUserPlants(
      { name: '초록이', images: [{ key: 'plant-image/0198.jpg' }] },
      accessToken,
    );

    expect(status).toBe(422);
    expect(body.errorCode).toBe('INVALID_USER_PLANT_IMAGES');
  });
});
