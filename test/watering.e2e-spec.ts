import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { userPlants, users, waterings } from '../src/database/schema';
import { setupE2E } from './helpers/setup-e2e';

// z.uuid()를 통과하는 명시적 uuid 픽스처 (version nibble 7 + variant 8).
const upId = (n: number) =>
  `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('Watering (e2e)', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;
  let ownerToken: string;
  let ownerId: string;
  let otherId: string;

  beforeAll(async () => {
    ({ app, container, db, pool } = await setupE2E());
    server = app.getHttpServer() as Server;

    // 소유자 + 타인 두 유저 가입 — owner 스코프(404 존재 은닉·기록 미누출) 검증용.
    const signup = async (accessToken: string, nickname: string) => {
      const res = await request(server)
        .post('/auth/signup')
        .send({ provider: 'kakao', platform: 'ios', accessToken, nickname });
      return (res.body as { accessToken: string }).accessToken;
    };
    ownerToken = await signup('watering-e2e-owner', '물주인');
    // 타인은 개체 소유자(otherId)로만 등장 — 요청 주체는 항상 owner(토큰 불필요).
    await signup('watering-e2e-other', '물이웃');

    const rows = await db
      .select({ id: users.id, nickname: users.nickname })
      .from(users);
    ownerId = rows.find((r) => r.nickname === '물주인')!.id;
    otherId = rows.find((r) => r.nickname === '물이웃')!.id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    // users는 유지(토큰 유저의 FK). waterings는 userPlants 삭제의 FK cascade가 지운다.
    await db.delete(userPlants);
  });

  const postWatering = async (
    plantId: string,
    payload: object,
    token?: string,
  ) => {
    let req = request(server).post(`/user-plants/${plantId}/waterings`);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req.send(payload);
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  const getWaterings = async (
    plantId: string,
    query: Record<string, string>,
    token?: string,
  ) => {
    let req = request(server)
      .get(`/user-plants/${plantId}/waterings`)
      .query(query);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return {
      status: res.status,
      body: res.body as {
        waterings: { id: string; wateredOn: string }[];
        nextCursor: string | null;
        errorCode?: string;
      },
    };
  };

  const deleteWatering = async (
    plantId: string,
    wateringId: string,
    token?: string,
  ) => {
    let req = request(server).delete(
      `/user-plants/${plantId}/waterings/${wateringId}`,
    );
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  // 개체 fixture — 기본은 owner 소유. n으로 여러 개체, ownerId 오버라이드로 타인 소유.
  const insertUserPlant = async (n = 1, owner = ownerId) => {
    await db.insert(userPlants).values({
      id: upId(n),
      ownerId: owner,
      name: `개체${n}`,
      images: [],
    });
    return upId(n);
  };

  const selectWaterings = (plantId: string) =>
    db
      .select({ id: waterings.id, wateredOn: waterings.wateredOn })
      .from(waterings)
      .where(eq(waterings.userPlantId, plantId));

  describe('POST /user-plants/:id/waterings (기록)', () => {
    it('201: 기록 생성 — body {id, wateredOn} + DB 왕복', async () => {
      const plantId = await insertUserPlant();

      const { status, body } = await postWatering(
        plantId,
        { wateredOn: '2026-07-18' },
        ownerToken,
      );
      expect(status).toBe(201);
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(body.wateredOn).toBe('2026-07-18');

      const rows = await selectWaterings(plantId);
      expect(rows).toEqual([
        { id: body.id as string, wateredOn: '2026-07-18' },
      ]);
    });

    it('201: 같은 날 재기록 = 멱등 — 둘 다 201 + 같은 id, DB엔 1행 (더블탭 안전)', async () => {
      const plantId = await insertUserPlant();

      const first = await postWatering(
        plantId,
        { wateredOn: '2026-07-18' },
        ownerToken,
      );
      const second = await postWatering(
        plantId,
        { wateredOn: '2026-07-18' },
        ownerToken,
      );
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.wateredOn).toBe('2026-07-18');

      expect(await selectWaterings(plantId)).toHaveLength(1);
    });

    it('201: 다른 날은 새 기록 — 2행', async () => {
      const plantId = await insertUserPlant();

      const first = await postWatering(
        plantId,
        { wateredOn: '2026-07-17' },
        ownerToken,
      );
      const second = await postWatering(
        plantId,
        { wateredOn: '2026-07-18' },
        ownerToken,
      );
      expect(second.body.id).not.toBe(first.body.id);
      expect(await selectWaterings(plantId)).toHaveLength(2);
    });

    it('201: 과거 backfill·미래 날짜 허용 — 서버가 유저의 "오늘"을 모른다', async () => {
      const plantId = await insertUserPlant();

      const past = await postWatering(
        plantId,
        { wateredOn: '2020-01-01' },
        ownerToken,
      );
      const future = await postWatering(
        plantId,
        { wateredOn: '2030-12-31' },
        ownerToken,
      );
      expect(past.status).toBe(201);
      expect(future.status).toBe(201);
    });

    it.each([
      ['wateredOn 누락', {}],
      ['wateredOn 형식 위반', { wateredOn: '2026/07/18' }],
      ['wateredOn datetime (date 아님)', { wateredOn: '2026-07-18T00:00:00Z' }],
    ])('400: %s (Zod)', async (_, payload) => {
      const plantId = await insertUserPlant();
      const { status } = await postWatering(plantId, payload, ownerToken);
      expect(status).toBe(400);
    });

    it('400: 개체 id 비uuid (Zod)', async () => {
      const { status } = await postWatering(
        'not-a-uuid',
        { wateredOn: '2026-07-18' },
        ownerToken,
      );
      expect(status).toBe(400);
    });

    it('401: 토큰 없음', async () => {
      const { status, body } = await postWatering(upId(1), {
        wateredOn: '2026-07-18',
      });
      expect(status).toBe(401);
      expect(body.errorCode).toBe('UNAUTHENTICATED');
    });

    it('404: 미존재 개체 → USER_PLANT_NOT_FOUND', async () => {
      const { status, body } = await postWatering(
        uuidv7(),
        { wateredOn: '2026-07-18' },
        ownerToken,
      );
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_PLANT_NOT_FOUND');
    });

    it('404: 타인 개체 — 기록이 생기지 않는다 (소유 스코프 INSERT 검증 + 존재 은닉)', async () => {
      const plantId = await insertUserPlant(9, otherId);

      const { status, body } = await postWatering(
        plantId,
        { wateredOn: '2026-07-18' },
        ownerToken,
      );
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_PLANT_NOT_FOUND');
      expect(await selectWaterings(plantId)).toHaveLength(0);
    });

    it('404: 타인 개체 + 그 날짜에 타인의 기록 존재 — 멱등 경로로 새지 않는다', async () => {
      // 재조회(멱등 해소)가 owner 스코프 없이 (개체, 날짜)만 보면 타인 기록이 201로 샌다.
      const plantId = await insertUserPlant(9, otherId);
      await db
        .insert(waterings)
        .values({ userPlantId: plantId, wateredOn: '2026-07-18' });

      const { status, body } = await postWatering(
        plantId,
        { wateredOn: '2026-07-18' },
        ownerToken,
      );
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_PLANT_NOT_FOUND');
    });
  });

  describe('GET /user-plants/:id/waterings (이력)', () => {
    it('200: 빈 이력 (개체는 존재) — { waterings: [], nextCursor: null }', async () => {
      const plantId = await insertUserPlant();

      const { status, body } = await getWaterings(plantId, {}, ownerToken);
      expect(status).toBe(200);
      expect(body).toEqual({ waterings: [], nextCursor: null });
    });

    it('200: wateredOn DESC — 생성순이 아니라 날짜순 (backfill이 제자리에 선다)', async () => {
      const plantId = await insertUserPlant();
      // 생성 순서를 날짜와 어긋나게 — 오늘 기록 후 과거를 backfill.
      await postWatering(plantId, { wateredOn: '2026-07-18' }, ownerToken);
      await postWatering(plantId, { wateredOn: '2026-07-10' }, ownerToken);
      await postWatering(plantId, { wateredOn: '2026-07-14' }, ownerToken);

      const { body } = await getWaterings(plantId, {}, ownerToken);
      expect(body.waterings.map((w) => w.wateredOn)).toEqual([
        '2026-07-18',
        '2026-07-14',
        '2026-07-10',
      ]);
    });

    it('200: limit=2 커서 워크 — 2/2/1, 무중복·무누락, 끝에서 null', async () => {
      const plantId = await insertUserPlant();
      const dates = [
        '2026-07-01',
        '2026-07-02',
        '2026-07-03',
        '2026-07-04',
        '2026-07-05',
      ];
      await db
        .insert(waterings)
        .values(dates.map((wateredOn) => ({ userPlantId: plantId, wateredOn })));

      const page1 = await getWaterings(plantId, { limit: '2' }, ownerToken);
      expect(page1.body.waterings.map((w) => w.wateredOn)).toEqual([
        '2026-07-05',
        '2026-07-04',
      ]);
      expect(page1.body.nextCursor).toBe('2026-07-04');

      const page2 = await getWaterings(
        plantId,
        { limit: '2', cursor: page1.body.nextCursor! },
        ownerToken,
      );
      expect(page2.body.waterings.map((w) => w.wateredOn)).toEqual([
        '2026-07-03',
        '2026-07-02',
      ]);
      expect(page2.body.nextCursor).toBe('2026-07-02');

      const page3 = await getWaterings(
        plantId,
        { limit: '2', cursor: page2.body.nextCursor! },
        ownerToken,
      );
      expect(page3.body.waterings.map((w) => w.wateredOn)).toEqual([
        '2026-07-01',
      ]);
      expect(page3.body.nextCursor).toBeNull();
    });

    it('200: 같은 소유자의 다른 개체 기록은 섞이지 않는다', async () => {
      const plantA = await insertUserPlant(1);
      const plantB = await insertUserPlant(2);
      await db.insert(waterings).values([
        { userPlantId: plantA, wateredOn: '2026-07-17' },
        { userPlantId: plantB, wateredOn: '2026-07-18' },
      ]);

      const { body } = await getWaterings(plantA, {}, ownerToken);
      expect(body.waterings.map((w) => w.wateredOn)).toEqual(['2026-07-17']);
    });

    it('404: 미존재 개체 → USER_PLANT_NOT_FOUND (빈 배열이 아니다)', async () => {
      const { status, body } = await getWaterings(uuidv7(), {}, ownerToken);
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_PLANT_NOT_FOUND');
    });

    it('404: 타인 개체 — 기록이 있어도 새지 않는다 (존재 은닉)', async () => {
      const plantId = await insertUserPlant(9, otherId);
      await db
        .insert(waterings)
        .values({ userPlantId: plantId, wateredOn: '2026-07-18' });

      const { status, body } = await getWaterings(plantId, {}, ownerToken);
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_PLANT_NOT_FOUND');
    });

    it('401: 토큰 없음', async () => {
      const { status } = await getWaterings(upId(1), {});
      expect(status).toBe(401);
    });

    it.each([
      ['cursor 형식 위반', { cursor: 'not-a-date' }],
      ['limit 0', { limit: '0' }],
      ['limit 51', { limit: '51' }],
    ])('400: %s (Zod)', async (_, query) => {
      const plantId = await insertUserPlant();
      const { status } = await getWaterings(plantId, query, ownerToken);
      expect(status).toBe(400);
    });
  });

  describe('DELETE /user-plants/:id/waterings/:wateringId (기록 삭제)', () => {
    const insertWatering = async (plantId: string, wateredOn: string) => {
      const [row] = await db
        .insert(waterings)
        .values({ userPlantId: plantId, wateredOn })
        .returning({ id: waterings.id });
      return row.id;
    };

    it('204: 빈 바디 + DB에서 행이 사라진다 (잘못 기록한 날 지우기)', async () => {
      const plantId = await insertUserPlant();
      const wateringId = await insertWatering(plantId, '2026-07-18');

      const { status, body } = await deleteWatering(
        plantId,
        wateringId,
        ownerToken,
      );
      expect(status).toBe(204);
      expect(body).toEqual({});
      expect(await selectWaterings(plantId)).toHaveLength(0);
    });

    it('404: 같은 기록 재삭제 → WATERING_NOT_FOUND', async () => {
      const plantId = await insertUserPlant();
      const wateringId = await insertWatering(plantId, '2026-07-18');

      await deleteWatering(plantId, wateringId, ownerToken);
      const { status, body } = await deleteWatering(
        plantId,
        wateringId,
        ownerToken,
      );
      expect(status).toBe(404);
      expect(body.errorCode).toBe('WATERING_NOT_FOUND');
    });

    it('404: 타인 소유 — 삭제되지 않는다 (존재 은닉)', async () => {
      const plantId = await insertUserPlant(9, otherId);
      const wateringId = await insertWatering(plantId, '2026-07-18');

      const { status, body } = await deleteWatering(
        plantId,
        wateringId,
        ownerToken,
      );
      expect(status).toBe(404);
      expect(body.errorCode).toBe('WATERING_NOT_FOUND');
      expect(await selectWaterings(plantId)).toHaveLength(1);
    });

    it('404: 내 개체 A의 기록을 개체 B 경로로 — URL 계층 위조 차단', async () => {
      const plantA = await insertUserPlant(1);
      const plantB = await insertUserPlant(2);
      const wateringId = await insertWatering(plantA, '2026-07-18');

      const { status, body } = await deleteWatering(
        plantB,
        wateringId,
        ownerToken,
      );
      expect(status).toBe(404);
      expect(body.errorCode).toBe('WATERING_NOT_FOUND');
      expect(await selectWaterings(plantA)).toHaveLength(1);
    });

    it('401: 토큰 없음', async () => {
      const { status } = await deleteWatering(upId(1), uuidv7());
      expect(status).toBe(401);
    });

    it('400: wateringId 비uuid (Zod)', async () => {
      const plantId = await insertUserPlant();
      const { status } = await deleteWatering(plantId, 'not-a-uuid', ownerToken);
      expect(status).toBe(400);
    });
  });

  describe('개체 삭제 연쇄 · 파생 필드 통합', () => {
    it('개체 삭제 시 물주기 기록도 함께 사라진다 (FK cascade)', async () => {
      const plantId = await insertUserPlant();
      await db
        .insert(waterings)
        .values({ userPlantId: plantId, wateredOn: '2026-07-18' });

      await request(server)
        .delete(`/user-plants/${plantId}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(await selectWaterings(plantId)).toHaveLength(0);
    });

    it('간격 설정 → 기록 → 상세·목록의 lastWateredOn(max)·nextWateringOn(+간격) 파생', async () => {
      // 개체 등록 (간격 7일) — 기록 전이라 예정일 없음.
      const created = await request(server)
        .post('/user-plants')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: '초록이', wateringIntervalDays: 7 });
      const plantId = (created.body as { id: string }).id;
      expect(created.body).toMatchObject({
        wateringIntervalDays: 7,
        lastWateredOn: null,
        nextWateringOn: null,
      });

      // 첫 기록 → 예정일 = 기록 + 7일.
      await postWatering(plantId, { wateredOn: '2026-07-01' }, ownerToken);
      const afterFirst = await request(server)
        .get(`/user-plants/${plantId}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(afterFirst.body).toMatchObject({
        lastWateredOn: '2026-07-01',
        nextWateringOn: '2026-07-08',
      });

      // 두 번째 기록 → last는 max(최신)로 갱신.
      await postWatering(plantId, { wateredOn: '2026-07-10' }, ownerToken);
      const afterSecond = await request(server)
        .get(`/user-plants/${plantId}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(afterSecond.body).toMatchObject({
        lastWateredOn: '2026-07-10',
        nextWateringOn: '2026-07-17',
      });

      // 목록에도 동일 파생 필드 (D-day 뱃지 소비처).
      const list = await request(server)
        .get('/user-plants')
        .set('Authorization', `Bearer ${ownerToken}`);
      const item = (
        list.body as { userPlants: Record<string, unknown>[] }
      ).userPlants.find((p) => p.id === plantId)!;
      expect(item).toMatchObject({
        wateringIntervalDays: 7,
        lastWateredOn: '2026-07-10',
        nextWateringOn: '2026-07-17',
      });

      // 간격 해제 → 예정일만 사라지고 기록(last)은 유지.
      const unset = await request(server)
        .patch(`/user-plants/${plantId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ wateringIntervalDays: null });
      expect(unset.body).toMatchObject({
        wateringIntervalDays: null,
        lastWateredOn: '2026-07-10',
        nextWateringOn: null,
      });
    });
  });
});
