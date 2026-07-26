import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { userBlocks, users } from '../src/database/schema';
import { setupE2E } from './helpers/setup-e2e';

const ABSENT_USER_ID = '00000000-0000-7000-8000-999999999999';

type BlockListBody = {
  blocks: Array<{ user: { id: string; nickname: string }; createdAt: string }>;
  nextCursor: string | null;
};

describe('UserBlock (e2e) — PUT·DELETE /users/:userId/block + GET /users/me/blocks', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;
  let aliceToken: string;
  let aliceId: string;
  let bobId: string;
  let carolId: string;

  beforeAll(async () => {
    ({ app, container, db, pool } = await setupE2E());
    server = app.getHttpServer() as Server;

    const signup = async (accessToken: string, nickname: string) => {
      const res = await request(server)
        .post('/auth/signup')
        .send({ provider: 'kakao', platform: 'ios', accessToken, nickname });
      return (res.body as { accessToken: string }).accessToken;
    };
    aliceToken = await signup('block-alice', '앨리스');
    await signup('block-bob', '보브');
    await signup('block-carol', '캐롤');

    const rows = await db
      .select({ id: users.id, nickname: users.nickname })
      .from(users);
    aliceId = rows.find((r) => r.nickname === '앨리스')!.id;
    bobId = rows.find((r) => r.nickname === '보브')!.id;
    carolId = rows.find((r) => r.nickname === '캐롤')!.id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    await db.delete(userBlocks);
  });

  // token: null = 무인증 요청 (undefined는 기본값이 적용돼 인증돼버린다 — null 센티널).
  const block = async (targetId: string, token: string | null = aliceToken) => {
    let req = request(server).put(`/users/${targetId}/block`);
    if (token !== null) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  const unblock = async (
    targetId: string,
    token: string | null = aliceToken,
  ) => {
    let req = request(server).delete(`/users/${targetId}/block`);
    if (token !== null) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  const listBlocks = async (
    query = '',
    token: string | null = aliceToken,
  ) => {
    let req = request(server).get(`/users/me/blocks${query}`);
    if (token !== null) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return { status: res.status, body: res.body as BlockListBody };
  };

  const selectBlocks = () =>
    db.select().from(userBlocks).where(eq(userBlocks.blockerId, aliceId));

  describe('PUT /users/:userId/block', () => {
    it('200: { blocked: true } — 행 생성', async () => {
      const { status, body } = await block(bobId);
      expect(status).toBe(200);
      expect(body).toEqual({ blocked: true });

      const rows = await selectBlocks();
      expect(rows).toHaveLength(1);
      expect(rows[0].blockedId).toBe(bobId);
    });

    it('200: 재차단은 멱등 — 행이 하나 그대로 (더블탭·재시도 안전)', async () => {
      await block(bobId);
      const { status, body } = await block(bobId);
      expect(status).toBe(200);
      expect(body).toEqual({ blocked: true });
      expect(await selectBlocks()).toHaveLength(1);
    });

    it('422 SELF_BLOCK: 자기 자신은 차단할 수 없다', async () => {
      const { status, body } = await block(aliceId);
      expect(status).toBe(422);
      expect(body.errorCode).toBe('SELF_BLOCK');
      expect(await selectBlocks()).toHaveLength(0);
    });

    it('404 BLOCK_TARGET_NOT_FOUND: 없는 유저 (사전 SELECT 아니라 FK 23503 번역)', async () => {
      const { status, body } = await block(ABSENT_USER_ID);
      expect(status).toBe(404);
      expect(body.errorCode).toBe('BLOCK_TARGET_NOT_FOUND');
    });

    it('401: 무인증', async () => {
      const { status } = await block(bobId, null);
      expect(status).toBe(401);
    });
  });

  describe('DELETE /users/:userId/block', () => {
    it('200: { blocked: false } — 행 삭제', async () => {
      await block(bobId);
      const { status, body } = await unblock(bobId);
      expect(status).toBe(200);
      expect(body).toEqual({ blocked: false });
      expect(await selectBlocks()).toHaveLength(0);
    });

    it('200: 차단하지 않은 상대의 해제도 멱등 성공', async () => {
      const { status, body } = await unblock(bobId);
      expect(status).toBe(200);
      expect(body).toEqual({ blocked: false });
    });

    // PUT과 의도적으로 갈리는 지점 — 해제의 목표 상태("차단 아님")에 이미 도달해 있다.
    it('200: 자기 자신·없는 유저의 해제는 422/404가 아니라 멱등 성공', async () => {
      expect((await unblock(aliceId)).status).toBe(200);
      expect((await unblock(ABSENT_USER_ID)).status).toBe(200);
    });

    it('401: 무인증', async () => {
      const { status } = await unblock(bobId, null);
      expect(status).toBe(401);
    });
  });

  describe('GET /users/me/blocks', () => {
    it('200: 내가 차단한 유저 목록 (닉네임 join)', async () => {
      await block(bobId);
      const { status, body } = await listBlocks();
      expect(status).toBe(200);
      expect(body.blocks).toHaveLength(1);
      expect(body.blocks[0].user).toEqual({ id: bobId, nickname: '보브' });
      expect(body.nextCursor).toBeNull();
    });

    it('200: 빈 목록', async () => {
      const { body } = await listBlocks();
      expect(body).toEqual({ blocks: [], nextCursor: null });
    });

    // "나를 차단한 사람"은 노출하지 않는다 — 차단은 상대가 알 수 없어야 조용한 조치가 된다.
    it('200: 나를 차단한 유저는 내 목록에 없다 (단방향 노출)', async () => {
      // 보브가 앨리스를 차단(반대 방향) — 앨리스 목록엔 나오지 않아야 한다.
      await db.insert(userBlocks).values({
        blockerId: bobId,
        blockedId: aliceId,
      });
      const { body } = await listBlocks();
      expect(body.blocks).toHaveLength(0);
    });

    it('200: keyset 페이지네이션 — user.id 오름차순, cursor로 다음 페이지', async () => {
      await block(bobId);
      await block(carolId);
      // 정렬 기준이 blocked_id ASC이므로 uuidv7 생성 순서(가입 순)와 같다.
      const [first, second] = [bobId, carolId].sort();

      const page1 = await listBlocks('?limit=1');
      expect(page1.body.blocks.map((b) => b.user.id)).toEqual([first]);
      expect(page1.body.nextCursor).toBe(first);

      const page2 = await listBlocks(`?limit=1&cursor=${first}`);
      expect(page2.body.blocks.map((b) => b.user.id)).toEqual([second]);
      expect(page2.body.nextCursor).toBeNull();
    });

    it('401: 무인증', async () => {
      const { status } = await listBlocks('', null);
      expect(status).toBe(401);
    });
  });
});
