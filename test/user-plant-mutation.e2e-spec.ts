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

// z.uuid()를 통과하는 명시적 uuid 픽스처 (version nibble 7 + variant 8).
const upId = (n: number) =>
  `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('UserPlantMutation (e2e)', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;
  let fakeStorage: FakeFileStorage;
  let ownerToken: string;
  let ownerId: string;
  let otherToken: string;

  beforeAll(async () => {
    ({ app, container, db, pool, fakeStorage } = await setupE2E());
    server = app.getHttpServer() as Server;

    // 소유자 + 타인 두 유저 가입 — owner 스코프(내 것만 수정/삭제·404 존재 은닉) 검증용.
    const signup = async (accessToken: string, nickname: string) => {
      const res = await request(server)
        .post('/auth/signup')
        .send({ provider: 'kakao', platform: 'ios', accessToken, nickname });
      return (res.body as { accessToken: string }).accessToken;
    };
    ownerToken = await signup('user-plant-mutation-owner', '수정소유자');
    otherToken = await signup('user-plant-mutation-other', '수정이웃');

    const rows = await db
      .select({ id: users.id, nickname: users.nickname })
      .from(users);
    ownerId = rows.find((r) => r.nickname === '수정소유자')!.id;
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

  const patchUserPlant = async (id: string, payload: object, token?: string) => {
    let req = request(server).patch(`/user-plants/${id}`);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req.send(payload);
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  const deleteUserPlant = async (id: string, token?: string) => {
    let req = request(server).delete(`/user-plants/${id}`);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  // 카탈로그 fixture (beforeEach가 지우므로 테스트 안에서 생성).
  const insertCatalogPlant = async () => {
    const [row] = await db
      .insert(plants)
      .values({
        name: '몬스테라 알보',
        images: [{ key: 'plant-image/catalog-cover.jpg' }],
      })
      .returning({ id: plants.id, name: plants.name });
    return row;
  };

  // 수정/삭제 대상 개체 fixture — 전 필드 채운 기본형(부분 수정의 "불변" 검증용).
  const insertUserPlant = async (
    overrides: Partial<typeof userPlants.$inferInsert> = {},
  ) => {
    await db.insert(userPlants).values({
      id: upId(1),
      ownerId,
      name: '초록이',
      images: [
        { key: 'user-plant-image/own-cover.jpg', width: 800, height: 600 },
      ],
      adoptedAt: '2026-05-01',
      memo: '거실 창가',
      ...overrides,
    });
    return upId(1);
  };

  describe('PATCH /user-plants/:id (부분 수정)', () => {
    it('200: 단일 필드({name}) — 나머지 필드는 건드리지 않는다 (merge-patch 핵심)', async () => {
      const id = await insertUserPlant();

      const { status, body } = await patchUserPlant(id, { name: '새이름' }, ownerToken);
      expect(status).toBe(200);
      expect(body).toEqual({
        id,
        name: '새이름',
        images: [
          {
            url: `${TEST_FILE_BASE_URL}/user-plant-image/own-cover.jpg`,
            width: 800,
            height: 600,
          },
        ],
        plant: null,
        adoptedAt: '2026-05-01',
        memo: '거실 창가',
        wateringIntervalDays: null,
        lastWateredOn: null,
        nextWateringOn: null,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
      });
    });

    it('200: 전체 패치 — 응답 = 조회 표현 (카탈로그 중첩·이미지 URL·adoptedAt 왕복)', async () => {
      const catalog = await insertCatalogPlant();
      const id = await insertUserPlant({ plantId: null, images: [] });

      const { status, body } = await patchUserPlant(
        id,
        {
          name: '  이사간 초록이  ',
          plantId: catalog.id,
          images: [
            { key: 'user-plant-image/new-cover.jpg', width: 1024, height: 768 },
            { key: 'user-plant-image/new-extra.jpg' },
          ],
          adoptedAt: '2026-06-15',
          memo: '베란다로 이사',
        },
        ownerToken,
      );
      expect(status).toBe(200);
      expect(body).toEqual({
        id,
        name: '이사간 초록이',
        images: [
          {
            url: `${TEST_FILE_BASE_URL}/user-plant-image/new-cover.jpg`,
            width: 1024,
            height: 768,
          },
          { url: `${TEST_FILE_BASE_URL}/user-plant-image/new-extra.jpg` },
        ],
        plant: { id: catalog.id, name: '몬스테라 알보' },
        adoptedAt: '2026-06-15',
        memo: '베란다로 이사',
        wateringIntervalDays: null,
        lastWateredOn: null,
        nextWateringOn: null,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
      });
    });

    it('200: 동정 승격({plantId}) — 미동정 개체에 카탈로그 연결 (스키마의 승격 경로)', async () => {
      const catalog = await insertCatalogPlant();
      const id = await insertUserPlant({ plantId: null });

      const { status, body } = await patchUserPlant(
        id,
        { plantId: catalog.id },
        ownerToken,
      );
      expect(status).toBe(200);
      expect(body.plant).toEqual({ id: catalog.id, name: '몬스테라 알보' });
    });

    it('200: null 해제({plantId,adoptedAt,memo}: null) — 부재(미변경)와 구분된다', async () => {
      const catalog = await insertCatalogPlant();
      const id = await insertUserPlant({ plantId: catalog.id });

      const { status, body } = await patchUserPlant(
        id,
        { plantId: null, adoptedAt: null, memo: null },
        ownerToken,
      );
      expect(status).toBe(200);
      expect(body.plant).toBeNull();
      expect(body.adoptedAt).toBeNull();
      expect(body.memo).toBeNull();
      // 미변경 필드는 유지.
      expect(body.name).toBe('초록이');

      const [row] = await db
        .select({ plantId: userPlants.plantId })
        .from(userPlants)
        .where(eq(userPlants.id, id));
      expect(row.plantId).toBeNull();
    });

    it('200: {images: []} — 전체 제거', async () => {
      const id = await insertUserPlant();

      const { status, body } = await patchUserPlant(id, { images: [] }, ownerToken);
      expect(status).toBe(200);
      expect(body.images).toEqual([]);
    });

    it('200: 물주기 간격 설정({wateringIntervalDays: 7}) → null 해제 — 부재(미변경)와 구분', async () => {
      const id = await insertUserPlant({ wateringIntervalDays: null });

      const set = await patchUserPlant(id, { wateringIntervalDays: 7 }, ownerToken);
      expect(set.status).toBe(200);
      expect(set.body.wateringIntervalDays).toBe(7);

      // 무관 필드 패치(부재 = 미변경) — 간격이 유지돼야 한다.
      const keep = await patchUserPlant(id, { name: '새이름' }, ownerToken);
      expect(keep.body.wateringIntervalDays).toBe(7);

      const unset = await patchUserPlant(
        id,
        { wateringIntervalDays: null },
        ownerToken,
      );
      expect(unset.status).toBe(200);
      expect(unset.body.wateringIntervalDays).toBeNull();
    });

    it.each([
      ['0 (최소 미만)', 0],
      ['366 (최대 초과)', 366],
    ])('400: wateringIntervalDays %s (Zod)', async (_, days) => {
      const id = await insertUserPlant();
      const { status } = await patchUserPlant(
        id,
        { wateringIntervalDays: days },
        ownerToken,
      );
      expect(status).toBe(400);
    });

    it('200: updatedAt이 갱신된다 ($onUpdate)', async () => {
      const id = await insertUserPlant();
      const [before] = await db
        .select({ updatedAt: userPlants.updatedAt })
        .from(userPlants)
        .where(eq(userPlants.id, id));

      await patchUserPlant(id, { name: '새이름' }, ownerToken);

      const [after] = await db
        .select({ updatedAt: userPlants.updatedAt })
        .from(userPlants)
        .where(eq(userPlants.id, id));
      expect(after.updatedAt.getTime()).toBeGreaterThan(
        before.updatedAt.getTime(),
      );
    });

    it('200: images 미제공이면 저장된 key를 head 재검증하지 않는다', async () => {
      const id = await insertUserPlant({
        images: [{ key: 'user-plant-image/stored.jpg' }],
      });
      // 저장된 key가 S3에서 사라졌더라도(수명주기 등) images를 안 건드리는 패치는 성공해야 한다.
      fakeStorage.missingKeys.add('user-plant-image/stored.jpg');

      const { status } = await patchUserPlant(id, { name: '새이름' }, ownerToken);
      expect(status).toBe(200);
    });

    it('400: 빈 바디({}) — no-op 패치는 클라 버그', async () => {
      const id = await insertUserPlant();
      const { status } = await patchUserPlant(id, {}, ownerToken);
      expect(status).toBe(400);
    });

    it.each([
      ['plantId 비uuid', { plantId: 'not-a-uuid' }],
      ['adoptedAt 형식 위반', { adoptedAt: '2026/05/01' }],
      ['name null (notnull 필드)', { name: null }],
    ])('400: %s (Zod)', async (_, payload) => {
      const id = await insertUserPlant();
      const { status } = await patchUserPlant(id, payload, ownerToken);
      expect(status).toBe(400);
    });

    it('401: 토큰 없음', async () => {
      const { status, body } = await patchUserPlant(upId(1), { name: 'x' });
      expect(status).toBe(401);
      expect(body.errorCode).toBe('UNAUTHENTICATED');
    });

    it('404: 미존재 id → USER_PLANT_NOT_FOUND', async () => {
      const { status, body } = await patchUserPlant(
        uuidv7(),
        { name: '새이름' },
        ownerToken,
      );
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_PLANT_NOT_FOUND');
    });

    it('404: 타인 개체 — 수정되지 않고 비존재와 구분 불가(존재 은닉)', async () => {
      const id = await insertUserPlant();

      const { status, body } = await patchUserPlant(
        id,
        { name: '탈취시도' },
        otherToken,
      );
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_PLANT_NOT_FOUND');

      const [row] = await db
        .select({ name: userPlants.name })
        .from(userPlants)
        .where(eq(userPlants.id, id));
      expect(row.name).toBe('초록이');
    });

    it('404 > 422: 타인 개체 + 불량 plantId — 0행이라 FK가 평가되지 않는다', async () => {
      const id = await insertUserPlant();

      const { status, body } = await patchUserPlant(
        id,
        { plantId: uuidv7() },
        otherToken,
      );
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_PLANT_NOT_FOUND');
    });

    it('422: 미존재 카탈로그 plantId → REFERENCED_PLANT_NOT_FOUND (FK 23503)', async () => {
      const id = await insertUserPlant();

      const { status, body } = await patchUserPlant(
        id,
        { plantId: uuidv7() },
        ownerToken,
      );
      expect(status).toBe(422);
      expect(body.errorCode).toBe('REFERENCED_PLANT_NOT_FOUND');
    });

    it('422: 업로드 안 된 image key → USER_PLANT_IMAGE_NOT_UPLOADED', async () => {
      const id = await insertUserPlant();
      const missing = 'user-plant-image/never-uploaded.jpg';
      fakeStorage.missingKeys.add(missing);

      const { status, body } = await patchUserPlant(
        id,
        { images: [{ key: missing }] },
        ownerToken,
      );
      expect(status).toBe(422);
      expect(body.errorCode).toBe('USER_PLANT_IMAGE_NOT_UPLOADED');
    });

    it('422: 잘못된 prefix key → INVALID_USER_PLANT_IMAGES', async () => {
      const id = await insertUserPlant();

      const { status, body } = await patchUserPlant(
        id,
        { images: [{ key: 'plant-image/catalog-cover.jpg' }] },
        ownerToken,
      );
      expect(status).toBe(422);
      expect(body.errorCode).toBe('INVALID_USER_PLANT_IMAGES');
    });
  });

  describe('DELETE /user-plants/:id (삭제)', () => {
    it('204: 빈 바디 + DB에서 행이 사라진다 (hard delete)', async () => {
      const id = await insertUserPlant();

      const { status, body } = await deleteUserPlant(id, ownerToken);
      expect(status).toBe(204);
      expect(body).toEqual({});

      const rows = await db
        .select({ id: userPlants.id })
        .from(userPlants)
        .where(eq(userPlants.id, id));
      expect(rows).toHaveLength(0);
    });

    it('404: 같은 id 재삭제 — 효과는 멱등, 상태코드는 404 (RFC 관례)', async () => {
      const id = await insertUserPlant();

      await deleteUserPlant(id, ownerToken);
      const { status, body } = await deleteUserPlant(id, ownerToken);
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_PLANT_NOT_FOUND');
    });

    it('404: 미존재 id → USER_PLANT_NOT_FOUND', async () => {
      const { status, body } = await deleteUserPlant(uuidv7(), ownerToken);
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_PLANT_NOT_FOUND');
    });

    it('404: 타인 개체 — 삭제되지 않고 비존재와 구분 불가(존재 은닉)', async () => {
      const id = await insertUserPlant();

      const { status, body } = await deleteUserPlant(id, otherToken);
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_PLANT_NOT_FOUND');

      const rows = await db
        .select({ id: userPlants.id })
        .from(userPlants)
        .where(eq(userPlants.id, id));
      expect(rows).toHaveLength(1);
    });

    it('401: 토큰 없음', async () => {
      const { status, body } = await deleteUserPlant(upId(1));
      expect(status).toBe(401);
      expect(body.errorCode).toBe('UNAUTHENTICATED');
    });

    it('400: 비uuid param (Zod)', async () => {
      const { status } = await deleteUserPlant('not-a-uuid', ownerToken);
      expect(status).toBe(400);
    });
  });
});
