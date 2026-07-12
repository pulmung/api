import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { plants, userPlants, users } from '../src/database/schema';
import { setupE2E } from './helpers/setup-e2e';
import { TEST_FILE_BASE_URL } from './helpers/test-env';

// 커서 테스트의 순서 결정성을 위한 명시적 uuid 픽스처 —
// version nibble 7 + variant 8이라 z.uuid()를 통과하고, n이 클수록 바이트 정렬상 뒤(=최신 취급).
const upId = (n: number) =>
  `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

type UserPlantListBody = {
  userPlants: Array<{ id: string } & Record<string, unknown>>;
  nextCursor: string | null;
};

describe('UserPlantRead (e2e)', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;
  let ownerToken: string;
  let ownerId: string;
  let otherToken: string;
  let otherId: string;

  beforeAll(async () => {
    ({ app, container, db, pool } = await setupE2E());
    server = app.getHttpServer() as Server;

    // 소유자 + 타인 두 유저 가입 — owner 스코프(내 것만·404 존재 은닉) 검증용.
    const signup = async (accessToken: string, nickname: string) => {
      const res = await request(server)
        .post('/auth/signup')
        .send({ provider: 'kakao', platform: 'ios', accessToken, nickname });
      return (res.body as { accessToken: string }).accessToken;
    };
    ownerToken = await signup('user-plant-read-owner', '읽기소유자');
    otherToken = await signup('user-plant-read-other', '읽기이웃');

    const rows = await db
      .select({ id: users.id, nickname: users.nickname })
      .from(users);
    ownerId = rows.find((r) => r.nickname === '읽기소유자')!.id;
    otherId = rows.find((r) => r.nickname === '읽기이웃')!.id;
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
  });

  const getList = async (query: Record<string, string> = {}, token?: string) => {
    let req = request(server).get('/user-plants').query(query);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return { status: res.status, body: res.body as UserPlantListBody };
  };

  const getDetail = async (id: string, token?: string) => {
    let req = request(server).get(`/user-plants/${id}`);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  // 카탈로그 fixture — 커버 폴백·중첩 요약 검증용 (beforeEach가 지우므로 테스트 안에서 생성).
  const insertCatalogPlant = async () => {
    const [row] = await db
      .insert(plants)
      .values({
        name: '몬스테라 알보',
        images: [
          { key: 'plant-image/catalog-cover.jpg', width: 640, height: 480 },
        ],
      })
      .returning({ id: plants.id, name: plants.name });
    return row;
  };

  describe('GET /user-plants (목록)', () => {
    it('401: 토큰 없음', async () => {
      const { status, body } = await getList();
      expect(status).toBe(401);
      expect((body as Record<string, unknown>).errorCode).toBe(
        'UNAUTHENTICATED',
      );
    });

    it('200: 빈 목록 — { userPlants: [], nextCursor: null }', async () => {
      const { status, body } = await getList({}, ownerToken);
      expect(status).toBe(200);
      expect(body).toEqual({ userPlants: [], nextCursor: null });
    });

    it('200: 내 것만 + id DESC(최신순) — 타인 개체는 더 최신이어도 제외', async () => {
      await db.insert(userPlants).values([
        { id: upId(1), ownerId, name: '첫째', images: [] },
        { id: upId(2), ownerId, name: '둘째', images: [] },
        { id: upId(3), ownerId, name: '셋째', images: [] },
        // 타인 개체가 바이트 정렬상 가장 최신 — 필터가 없으면 첫 아이템으로 샌다.
        { id: upId(100), ownerId: otherId, name: '이웃식물', images: [] },
      ]);

      const { status, body } = await getList({}, ownerToken);
      expect(status).toBe(200);
      expect(body.userPlants.map((p) => p.id)).toEqual([
        upId(3),
        upId(2),
        upId(1),
      ]);
    });

    it('coverImage 3분기: 내 사진 우선 / 카탈로그 폴백 / 둘 다 없으면 null', async () => {
      const catalog = await insertCatalogPlant();
      await db.insert(userPlants).values([
        // 사진도 카탈로그도 없음 → null (플레이스홀더는 클라 몫)
        { id: upId(1), ownerId, name: '빈손이', images: [] },
        // 사진 없음 + 카탈로그 연결 → 카탈로그 대표로 폴백
        {
          id: upId(2),
          ownerId,
          name: '폴백이',
          images: [],
          plantId: catalog.id,
          adoptedAt: '2026-05-01',
        },
        // 내 사진 있음 → 카탈로그가 연결돼 있어도 내 사진[0]이 이긴다
        {
          id: upId(3),
          ownerId,
          name: '초록이',
          images: [
            { key: 'user-plant-image/own-cover.jpg', width: 800, height: 600 },
            { key: 'user-plant-image/own-extra.jpg' },
          ],
          plantId: catalog.id,
        },
      ]);

      const { body } = await getList({}, ownerToken);
      expect(body.userPlants).toEqual([
        {
          id: upId(3),
          name: '초록이',
          coverImage: {
            url: `${TEST_FILE_BASE_URL}/user-plant-image/own-cover.jpg`,
            width: 800,
            height: 600,
          },
          plant: { id: catalog.id, name: '몬스테라 알보' },
          adoptedAt: null,
          createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
        },
        {
          id: upId(2),
          name: '폴백이',
          coverImage: {
            url: `${TEST_FILE_BASE_URL}/plant-image/catalog-cover.jpg`,
            width: 640,
            height: 480,
          },
          plant: { id: catalog.id, name: '몬스테라 알보' },
          adoptedAt: '2026-05-01',
          createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
        },
        {
          id: upId(1),
          name: '빈손이',
          coverImage: null,
          plant: null,
          adoptedAt: null,
          createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
        },
      ]);
      // 누출 가드: 전체 images·memo는 목록 계약에 없다(serializer strip).
      expect(body.userPlants[0]).not.toHaveProperty('images');
      expect(body.userPlants[0]).not.toHaveProperty('memo');
    });

    it('200: limit=3 커서 워크 — 3/2, 무중복·무누락, 끝에서 null (타인 행 사이 끼움)', async () => {
      await db.insert(userPlants).values([
        ...[10, 20, 30, 40, 50].map((n) => ({
          id: upId(n),
          ownerId,
          name: `식물${n}`,
          images: [],
        })),
        // keyset 범위 한가운데(30~40 사이)와 최신 위치의 타인 행 —
        // limit+1 선조회·커서 경계 어디서도 새면 안 된다.
        { id: upId(35), ownerId: otherId, name: '이웃A', images: [] },
        { id: upId(60), ownerId: otherId, name: '이웃B', images: [] },
      ]);

      const page1 = await getList({ limit: '3' }, ownerToken);
      expect(page1.body.userPlants.map((p) => p.id)).toEqual([
        upId(50),
        upId(40),
        upId(30),
      ]);
      expect(page1.body.nextCursor).toBe(upId(30));

      const page2 = await getList(
        { limit: '3', cursor: page1.body.nextCursor! },
        ownerToken,
      );
      expect(page2.body.userPlants.map((p) => p.id)).toEqual([
        upId(20),
        upId(10),
      ]);
      expect(page2.body.nextCursor).toBeNull();
    });

    it.each(['0', '51', 'abc'])('400: limit=%s (Zod)', async (limit) => {
      const { status } = await getList({ limit }, ownerToken);
      expect(status).toBe(400);
    });

    it('400: cursor 비uuid (Zod)', async () => {
      const { status } = await getList({ cursor: 'not-a-uuid' }, ownerToken);
      expect(status).toBe(400);
    });
  });

  describe('GET /user-plants/:id (상세)', () => {
    it('401: 토큰 없음', async () => {
      const { status } = await getDetail(upId(1));
      expect(status).toBe(401);
    });

    it('200: 상세 — POST 201과 같은 조회 표현 (images 전체 + 카탈로그 중첩 + memo)', async () => {
      const catalog = await insertCatalogPlant();
      await db.insert(userPlants).values({
        id: upId(1),
        ownerId,
        name: '초록이',
        images: [
          { key: 'user-plant-image/own-cover.jpg', width: 800, height: 600 },
          { key: 'user-plant-image/own-extra.jpg' },
        ],
        plantId: catalog.id,
        adoptedAt: '2026-05-01',
        memo: '거실 창가',
      });

      const { status, body } = await getDetail(upId(1), ownerToken);
      expect(status).toBe(200);
      expect(body).toEqual({
        id: upId(1),
        name: '초록이',
        images: [
          {
            url: `${TEST_FILE_BASE_URL}/user-plant-image/own-cover.jpg`,
            width: 800,
            height: 600,
          },
          { url: `${TEST_FILE_BASE_URL}/user-plant-image/own-extra.jpg` },
        ],
        plant: { id: catalog.id, name: '몬스테라 알보' },
        adoptedAt: '2026-05-01',
        memo: '거실 창가',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
      });
    });

    it('404: 미존재 id → USER_PLANT_NOT_FOUND', async () => {
      const { status, body } = await getDetail(upId(999), ownerToken);
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_PLANT_NOT_FOUND');
    });

    it('404: 타인 개체 — 비존재와 구분 불가(존재 은닉)', async () => {
      await db.insert(userPlants).values({
        id: upId(1),
        ownerId,
        name: '초록이',
        images: [],
      });

      const { status, body } = await getDetail(upId(1), otherToken);
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_PLANT_NOT_FOUND');
    });

    it('400: 비uuid param (Zod)', async () => {
      const { status } = await getDetail('not-a-uuid', ownerToken);
      expect(status).toBe(400);
    });
  });
});
