import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { plants } from '../src/database/schema';
import { setupE2E } from './helpers/setup-e2e';
import { TEST_FILE_BASE_URL } from './helpers/test-env';

// 커서 테스트의 순서 결정성을 위한 명시적 uuid 픽스처 —
// version nibble 7 + variant 8이라 z.uuid()를 통과하고, n이 클수록 바이트 정렬상 뒤(=최신 취급).
const plantId = (n: number) =>
  `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

type PlantListBody = {
  plants: Array<{ id: string } & Record<string, unknown>>;
  nextCursor: string | null;
};

describe('PlantRead (e2e)', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;

  const getPlants = async (query: Record<string, string> = {}) => {
    const res = await request(server).get('/plants').query(query);
    return {
      status: res.status,
      body: res.body as PlantListBody,
      headers: res.headers,
    };
  };

  beforeAll(async () => {
    ({ app, container, db, pool } = await setupE2E());
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await container.stop();
  });

  // 시드 전에 실행된다(파일 내 선언 순서 = 실행 순서).
  it('200: 빈 카탈로그 — { plants: [], nextCursor: null }', async () => {
    const { status, body } = await getPlants();
    expect(status).toBe(200);
    expect(body).toEqual({ plants: [], nextCursor: null });
  });

  describe('25개 시드 후', () => {
    beforeAll(async () => {
      // 공개 라우트라 인증 셋업 불필요, createdById: null 유효(카탈로그는 공유 자산).
      // 최신(=목록 첫 아이템)인 25번만 이미지 2장 — 커버 선택·상세 순서 검증용.
      await db.insert(plants).values(
        Array.from({ length: 25 }, (_, i) => {
          const n = i + 1;
          return {
            id: plantId(n),
            name: `식물${n}`,
            images:
              n === 25
                ? [
                    { key: 'plant-image/cover-25.jpg', width: 800, height: 600 },
                    { key: 'plant-image/extra-25.jpg' },
                  ]
                : [{ key: `plant-image/p-${n}.jpg` }],
            genus: n === 25 ? '몬스테라' : null,
            species: n === 25 ? '델리시오사' : null,
            category: n === 25 ? ('관엽' as const) : null,
          };
        }),
      );
    });

    it('200: 기본 limit=20 — id DESC(최신순) + nextCursor = 20번째 id', async () => {
      const { status, body } = await getPlants();
      expect(status).toBe(200);
      expect(body.plants).toHaveLength(20);
      expect(body.plants.map((p) => p.id)).toEqual(
        Array.from({ length: 20 }, (_, i) => plantId(25 - i)),
      );
      expect(body.nextCursor).toBe(plantId(6));
    });

    it('200: limit=10 커서 워크 — 10/10/5, 무중복·무누락, 끝에서 null', async () => {
      const page1 = await getPlants({ limit: '10' });
      expect(page1.body.plants).toHaveLength(10);
      expect(page1.body.nextCursor).toBe(plantId(16));

      const page2 = await getPlants({ limit: '10', cursor: page1.body.nextCursor! });
      expect(page2.body.plants).toHaveLength(10);
      expect(page2.body.nextCursor).toBe(plantId(6));

      const page3 = await getPlants({ limit: '10', cursor: page2.body.nextCursor! });
      expect(page3.body.plants).toHaveLength(5);
      expect(page3.body.nextCursor).toBeNull();

      const allIds = [page1, page2, page3].flatMap((p) =>
        p.body.plants.map((item) => item.id),
      );
      expect(new Set(allIds).size).toBe(25);
    });

    it('200: 총 행수 == limit — 첫 페이지에서 nextCursor null (n+1 경계)', async () => {
      const { body } = await getPlants({ limit: '25' });
      expect(body.plants).toHaveLength(25);
      expect(body.nextCursor).toBeNull();
    });

    it('200: cursor = 가장 오래된 id — 빈 페이지', async () => {
      const { body } = await getPlants({ cursor: plantId(1) });
      expect(body).toEqual({ plants: [], nextCursor: null });
    });

    it('200: cursor = 미존재 유효 uuid — keyset 의미론(존재 검사 없음)', async () => {
      // hex '01a'는 '019'(19번)와 '020'(20번) 사이 — 테이블에 없는 값.
      const { status, body } = await getPlants({
        cursor: '00000000-0000-7000-8000-00000000001a',
        limit: '50',
      });
      expect(status).toBe(200);
      expect(body.plants.map((p) => p.id)).toEqual(
        Array.from({ length: 19 }, (_, i) => plantId(19 - i)),
      );
    });

    it('200: limit 경계 1·50 통과', async () => {
      const min = await getPlants({ limit: '1' });
      expect(min.status).toBe(200);
      expect(min.body.plants).toHaveLength(1);

      const max = await getPlants({ limit: '50' });
      expect(max.status).toBe(200);
      expect(max.body.plants).toHaveLength(25);
      expect(max.body.nextCursor).toBeNull();
    });

    it.each(['0', '51', 'abc', '1.5'])('400: limit=%s (Zod)', async (limit) => {
      const { status } = await getPlants({ limit });
      expect(status).toBe(400);
    });

    it.each(['not-a-uuid', ''])('400: cursor=%j (Zod)', async (cursor) => {
      const { status } = await getPlants({ cursor });
      expect(status).toBe(400);
    });

    it('목록 아이템 모양: coverImage = images[0] URL 조합, key·images 미노출', async () => {
      const { body } = await getPlants({ limit: '1' });
      const [item] = body.plants;
      expect(item).toEqual({
        id: plantId(25),
        name: '식물25',
        coverImage: {
          url: `${TEST_FILE_BASE_URL}/plant-image/cover-25.jpg`,
          width: 800,
          height: 600,
        },
        genus: '몬스테라',
        species: '델리시오사',
        category: '관엽',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
      });
      // 누출 가드: 불투명 key·전체 images는 목록 계약에 없다(serializer strip).
      expect(item).not.toHaveProperty('images');
      expect(item.coverImage).not.toHaveProperty('key');
    });

    it('200: 상세 — images 전체를 저장 순서대로 URL 조합', async () => {
      const res = await request(server).get(`/plants/${plantId(25)}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: plantId(25),
        name: '식물25',
        images: [
          {
            url: `${TEST_FILE_BASE_URL}/plant-image/cover-25.jpg`,
            width: 800,
            height: 600,
          },
          { url: `${TEST_FILE_BASE_URL}/plant-image/extra-25.jpg` },
        ],
        genus: '몬스테라',
        species: '델리시오사',
        category: '관엽',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
      });
    });

    it('404: 상세 — 미존재 id → PLANT_NOT_FOUND', async () => {
      const res = await request(server).get(
        '/plants/00000000-0000-7000-8000-999999999999',
      );
      expect(res.status).toBe(404);
      expect((res.body as Record<string, unknown>).errorCode).toBe(
        'PLANT_NOT_FOUND',
      );
    });

    it('400: 상세 — 비uuid param (Zod)', async () => {
      const res = await request(server).get('/plants/not-a-uuid');
      expect(res.status).toBe(400);
    });

    it('목록·상세 모두 Cache-Control 없음 (유저 생성 데이터 — 사전과 다름)', async () => {
      const list = await getPlants();
      expect(list.headers['cache-control']).toBeUndefined();

      const detail = await request(server).get(`/plants/${plantId(25)}`);
      expect(detail.headers['cache-control']).toBeUndefined();
    });
  });
});
