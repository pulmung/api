import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { postLikes, posts, users } from '../src/database/schema';
import { setupE2E } from './helpers/setup-e2e';

// 커서·정렬 결정성을 위한 명시적 uuid 픽스처(post-read 전례) — n이 클수록 최신 취급.
const postId = (n: number) =>
  `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const POST_ID = postId(1);

describe('PostLike (e2e) — PUT·DELETE /posts/:postId/like + 읽기의 isLiked', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;
  let aliceToken: string;
  let aliceId: string;
  let bobToken: string;

  beforeAll(async () => {
    ({ app, container, db, pool } = await setupE2E());
    server = app.getHttpServer() as Server;

    const signup = async (accessToken: string, nickname: string) => {
      const res = await request(server)
        .post('/auth/signup')
        .send({ provider: 'kakao', platform: 'ios', accessToken, nickname });
      return (res.body as { accessToken: string }).accessToken;
    };
    aliceToken = await signup('post-like-alice', '앨리스');
    bobToken = await signup('post-like-bob', '보브');

    // 앨리스는 글 작성자(픽스처의 authorId)이자 좋아요 주체 — 보브는 토큰만 있으면 된다.
    const rows = await db
      .select({ id: users.id, nickname: users.nickname })
      .from(users);
    aliceId = rows.find((r) => r.nickname === '앨리스')!.id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    // posts 삭제가 post_likes를 cascade로 쓸어간다 — 매 테스트가 카운터 0에서 시작.
    await db.delete(posts);
    await insertPost(POST_ID);
  });

  const insertPost = (id: string, title = '제목') =>
    db.insert(posts).values({
      id,
      authorId: aliceId,
      title,
      content: '<p>본문</p>',
      excerpt: '본문',
      imageKeys: [],
    });

  // token: null = 무인증 요청 (undefined를 넘기면 기본값이 적용돼 인증돼버린다 — null 센티널).
  const like = async (
    id: string = POST_ID,
    token: string | null = aliceToken,
  ) => {
    let req = request(server).put(`/posts/${id}/like`);
    if (token !== null) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  const unlike = async (
    id: string = POST_ID,
    token: string | null = aliceToken,
  ) => {
    let req = request(server).delete(`/posts/${id}/like`);
    if (token !== null) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  const getDetail = async (
    id: string = POST_ID,
    token: string | null = null,
  ) => {
    let req = request(server).get(`/posts/${id}`);
    if (token !== null) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return {
      status: res.status,
      headers: res.headers as Record<string, string>,
      body: res.body as Record<string, unknown>,
    };
  };

  const getList = async (token: string | null = null) => {
    let req = request(server).get('/posts');
    if (token !== null) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return {
      status: res.status,
      headers: res.headers as Record<string, string>,
      body: res.body as {
        posts: Array<{ id: string; likeCount: number; isLiked: boolean }>;
      },
    };
  };

  const selectPost = async (id: string = POST_ID) => {
    const [row] = await db.select().from(posts).where(eq(posts.id, id));
    return row;
  };

  describe('PUT /posts/:postId/like (좋아요)', () => {
    it('200: { isLiked: true, likeCount } — 행 생성 + 카운터 +1', async () => {
      const { status, body } = await like();
      expect(status).toBe(200);
      expect(body).toEqual({ isLiked: true, likeCount: 1 });

      const rows = await db
        .select()
        .from(postLikes)
        .where(eq(postLikes.postId, POST_ID));
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(aliceId);
      expect((await selectPost()).likeCount).toBe(1);
    });

    it('200: 재좋아요는 멱등 — 카운터 불변, 행도 하나 그대로 (더블탭·재시도 안전)', async () => {
      await like();
      const { status, body } = await like();

      expect(status).toBe(200);
      expect(body).toEqual({ isLiked: true, likeCount: 1 });
      expect(
        await db.select().from(postLikes).where(eq(postLikes.postId, POST_ID)),
      ).toHaveLength(1);
    });

    it('posts.updatedAt·commentCount 불변 ($onUpdate 억제 — 좋아요 ≠ 글 수정)', async () => {
      const before = await selectPost();
      await like();

      const after = await selectPost();
      expect(after.updatedAt.toISOString()).toBe(
        before.updatedAt.toISOString(),
      );
      expect(after.commentCount).toBe(0);
    });

    it('두 유저의 좋아요는 서로 독립 — 카운터 2', async () => {
      expect((await like(POST_ID, aliceToken)).body.likeCount).toBe(1);
      expect((await like(POST_ID, bobToken)).body.likeCount).toBe(2);
      expect((await selectPost()).likeCount).toBe(2);
    });

    it('다른 글의 좋아요에 영향 없음 (postId 조건 가드)', async () => {
      await insertPost(postId(2), '다른 글');
      await like(POST_ID);

      expect((await selectPost(postId(2))).likeCount).toBe(0);
      const { body } = await getDetail(postId(2), aliceToken);
      expect(body.isLiked).toBe(false);
      expect(body.likeCount).toBe(0);
    });

    it('404: 비존재 글 → POST_NOT_FOUND (FK 번역, 사전 SELECT 없음)', async () => {
      const { status, body } = await like(uuidv7());
      expect(status).toBe(404);
      expect(body.errorCode).toBe('POST_NOT_FOUND');
    });

    it('401: 토큰 없음 → UNAUTHENTICATED', async () => {
      const { status, body } = await like(POST_ID, null);
      expect(status).toBe(401);
      expect(body.errorCode).toBe('UNAUTHENTICATED');
    });

    it('400: 비uuid postId (Zod)', async () => {
      const { status } = await like('not-a-uuid');
      expect(status).toBe(400);
    });
  });

  describe('DELETE /posts/:postId/like (좋아요 취소)', () => {
    it('200: { isLiked: false, likeCount } — 행 삭제 + 카운터 −1', async () => {
      await like();
      const { status, body } = await unlike();

      expect(status).toBe(200);
      expect(body).toEqual({ isLiked: false, likeCount: 0 });
      expect(
        await db.select().from(postLikes).where(eq(postLikes.postId, POST_ID)),
      ).toEqual([]);
      expect((await selectPost()).likeCount).toBe(0);
    });

    it('200: 좋아요하지 않은 글의 취소도 멱등 — 카운터 불변', async () => {
      const { status, body } = await unlike();
      expect(status).toBe(200);
      expect(body).toEqual({ isLiked: false, likeCount: 0 });
      expect((await selectPost()).likeCount).toBe(0);
    });

    it('남의 좋아요를 깎지 않는다 — 밥이 취소해도 앨리스 좋아요·카운터 유지', async () => {
      await like(POST_ID, aliceToken);

      const { status, body } = await unlike(POST_ID, bobToken);
      expect(status).toBe(200);
      // 밥 기준으론 "좋아요 안 함"이 맞지만 전역 카운터는 앨리스 몫이 남아 1이다.
      expect(body).toEqual({ isLiked: false, likeCount: 1 });
      expect((await selectPost()).likeCount).toBe(1);
      expect((await getDetail(POST_ID, aliceToken)).body.isLiked).toBe(true);
    });

    it('좋아요 → 취소 → 재좋아요 왕복 후 카운터 1 (증감이 대칭)', async () => {
      await like();
      await unlike();
      const { body } = await like();
      expect(body.likeCount).toBe(1);
      expect((await selectPost()).likeCount).toBe(1);
    });

    it('posts.updatedAt 불변', async () => {
      await like();
      const before = await selectPost();
      await unlike();
      expect((await selectPost()).updatedAt.toISOString()).toBe(
        before.updatedAt.toISOString(),
      );
    });

    it('404: 비존재 글 → POST_NOT_FOUND (좋아요 부재와 글 부재는 다르다)', async () => {
      const { status, body } = await unlike(uuidv7());
      expect(status).toBe(404);
      expect(body.errorCode).toBe('POST_NOT_FOUND');
    });

    it('401: 토큰 없음', async () => {
      const { status } = await unlike(POST_ID, null);
      expect(status).toBe(401);
    });
  });

  describe('동시성', () => {
    it('같은 유저의 동시 좋아요 5건 → 카운터 1 (복합 PK가 멱등의 근거)', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () => like()),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect((await selectPost()).likeCount).toBe(1);
    });

    it('서로 다른 유저의 동시 좋아요 2건 → 카운터 2 (읽고-쓰기가 아니라 SQL 식 증감)', async () => {
      await Promise.all([like(POST_ID, aliceToken), like(POST_ID, bobToken)]);
      expect((await selectPost()).likeCount).toBe(2);
    });
  });

  describe('읽기 경로의 isLiked (@OptionalAuth)', () => {
    it('상세: 좋아요한 뷰어 true / 다른 유저 false / 익명 false — likeCount는 모두 동일', async () => {
      await like(POST_ID, aliceToken);

      const mine = await getDetail(POST_ID, aliceToken);
      expect(mine.body.isLiked).toBe(true);
      expect(mine.body.likeCount).toBe(1);

      const other = await getDetail(POST_ID, bobToken);
      expect(other.body.isLiked).toBe(false);
      expect(other.body.likeCount).toBe(1);

      const anonymous = await getDetail(POST_ID, null);
      expect(anonymous.status).toBe(200);
      expect(anonymous.body.isLiked).toBe(false);
      expect(anonymous.body.likeCount).toBe(1);
    });

    it('목록: 섞인 페이지에서 아이템별로 갈린다 (내 좋아요 / 남의 좋아요 / 없음)', async () => {
      await insertPost(postId(2), '남이 좋아요한 글');
      await insertPost(postId(3), '아무도 안 누른 글');
      await like(postId(1), aliceToken);
      await like(postId(2), bobToken);

      const { body } = await getList(aliceToken);
      // 최신순(id DESC)이라 3 → 2 → 1.
      const byId = new Map(body.posts.map((p) => [p.id, p]));
      expect(byId.get(postId(1))).toMatchObject({
        isLiked: true,
        likeCount: 1,
      });
      expect(byId.get(postId(2))).toMatchObject({
        isLiked: false,
        likeCount: 1,
      });
      expect(byId.get(postId(3))).toMatchObject({
        isLiked: false,
        likeCount: 0,
      });
    });

    it('목록·상세는 뷰어별 응답이라 공유 캐시 금지 헤더가 붙는다', async () => {
      const list = await getList(aliceToken);
      expect(list.headers['cache-control']).toBe('private, no-store');
      expect(list.headers['vary']).toContain('Authorization');

      const detail = await getDetail(POST_ID, aliceToken);
      expect(detail.headers['cache-control']).toBe('private, no-store');
    });

    it('401: 헤더를 보냈는데 토큰이 유효하지 않으면 공개 라우트도 401 (익명 강등 안 함)', async () => {
      const list = await getList('garbage-token');
      expect(list.status).toBe(401);

      const detail = await getDetail(POST_ID, 'garbage-token');
      expect(detail.status).toBe(401);
      expect(detail.body.errorCode).toBe('UNAUTHENTICATED');
    });

    it('작성/수정 응답도 같은 조회 표현 — 작성자 기준 isLiked가 실제로 배선돼 있다', async () => {
      const created = await request(server)
        .post('/posts')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ title: '새 글', content: '<p>내용</p>' });
      expect(created.status).toBe(201);
      const newId = (created.body as { id: string }).id;
      expect(created.body).toMatchObject({ likeCount: 0, isLiked: false });

      await like(newId, aliceToken);

      const patched = await request(server)
        .patch(`/posts/${newId}`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ title: '고친 글' });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ likeCount: 1, isLiked: true });
    });
  });

  describe('글 삭제 cascade', () => {
    it('글을 지우면 좋아요 행도 사라진다', async () => {
      await like(POST_ID, aliceToken);
      await like(POST_ID, bobToken);
      expect(await db.select().from(postLikes)).toHaveLength(2);

      const res = await request(server)
        .delete(`/posts/${POST_ID}`)
        .set('Authorization', `Bearer ${aliceToken}`);
      expect(res.status).toBe(204);

      expect(await db.select().from(postLikes)).toEqual([]);
      // 사라진 글에 대한 좋아요는 404 — 고아 행이 남아 성공하는 일이 없다.
      expect((await like(POST_ID)).status).toBe(404);
    });
  });
});
