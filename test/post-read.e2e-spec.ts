import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { plants, posts, users, type NewPost } from '../src/database/schema';
import { setupE2E } from './helpers/setup-e2e';
import { TEST_FILE_BASE_URL } from './helpers/test-env';

// 커서 테스트의 순서 결정성을 위한 명시적 uuid 픽스처 —
// version nibble 7 + variant 8이라 z.uuid()를 통과하고, n이 클수록 바이트 정렬상 뒤(=최신 취급).
const postId = (n: number) =>
  `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

type PostListBody = {
  posts: Array<{ id: string } & Record<string, unknown>>;
  nextCursor: string | null;
};

describe('PostRead (e2e) — 공개 게시판 읽기', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;
  let authorAId: string;
  let authorBId: string;

  beforeAll(async () => {
    ({ app, container, db, pool } = await setupE2E());
    server = app.getHttpServer() as Server;

    // 읽기는 공개(토큰 불필요)지만, authorId 필터·작성자 표시 검증용으로 유저 2명 필요.
    const signup = (accessToken: string, nickname: string) =>
      request(server)
        .post('/auth/signup')
        .send({ provider: 'kakao', platform: 'ios', accessToken, nickname });
    await signup('post-read-author-a', '작가A');
    await signup('post-read-author-b', '작가B');

    const rows = await db
      .select({ id: users.id, nickname: users.nickname })
      .from(users);
    authorAId = rows.find((r) => r.nickname === '작가A')!.id;
    authorBId = rows.find((r) => r.nickname === '작가B')!.id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    await db.delete(posts);
    await db.delete(plants);
  });

  // 파생 컬럼(excerpt·imageKeys)은 NOT NULL — 픽스처도 쓰기 경로의 계약대로 명시 공급.
  const insertPost = (overrides: Partial<NewPost> & { id: string }) =>
    db.insert(posts).values({
      authorId: authorAId,
      title: '제목',
      content: '<p>본문</p>',
      excerpt: '본문',
      imageKeys: [],
      ...overrides,
    });

  const getList = async (query: Record<string, string> = {}) => {
    const res = await request(server).get('/posts').query(query);
    return { status: res.status, body: res.body as PostListBody };
  };

  const getDetail = async (id: string) => {
    const res = await request(server).get(`/posts/${id}`);
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  describe('GET /posts (목록 — 공개)', () => {
    it('200: 토큰 없이 접근 가능, 빈 목록 = { posts: [], nextCursor: null }', async () => {
      const { status, body } = await getList();
      expect(status).toBe(200);
      expect(body).toEqual({ posts: [], nextCursor: null });
    });

    it('200: 아이템 형태 — 작성자·태그·썸네일 URL·발췌, content는 목록에 없다(누출 가드)', async () => {
      const [catalog] = await db
        .insert(plants)
        .values({ name: '몬스테라 알보', images: [{ key: 'plant-image/c.jpg' }] })
        .returning({ id: plants.id });
      await insertPost({
        id: postId(1),
        plantId: catalog.id,
        title: '잎이 갈변해요',
        content: '<p>긴 본문…</p>',
        excerpt: '긴 본문…',
        thumbnailKey: 'post-image/thumb.jpg',
        imageKeys: ['post-image/thumb.jpg'],
      });

      const { body } = await getList();
      expect(body.posts).toEqual([
        {
          id: postId(1),
          title: '잎이 갈변해요',
          excerpt: '긴 본문…',
          thumbnailUrl: `${TEST_FILE_BASE_URL}/post-image/thumb.jpg`,
          author: { id: authorAId, nickname: '작가A' },
          plant: { id: catalog.id, name: '몬스테라 알보' },
          commentCount: 0,
          createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
        },
      ]);
      // 본문(50k까지 가능)·updatedAt은 상세 전용 — serializer가 strip.
      expect(body.posts[0]).not.toHaveProperty('content');
      expect(body.posts[0]).not.toHaveProperty('updatedAt');
    });

    it('200: limit=2 커서 워크 — 2/2/1, 무중복·무누락, 끝에서 null', async () => {
      await Promise.all(
        [1, 2, 3, 4, 5].map((n) => insertPost({ id: postId(n * 10) })),
      );

      const page1 = await getList({ limit: '2' });
      expect(page1.body.posts.map((p) => p.id)).toEqual([postId(50), postId(40)]);
      expect(page1.body.nextCursor).toBe(postId(40));

      const page2 = await getList({ limit: '2', cursor: page1.body.nextCursor! });
      expect(page2.body.posts.map((p) => p.id)).toEqual([postId(30), postId(20)]);

      const page3 = await getList({ limit: '2', cursor: page2.body.nextCursor! });
      expect(page3.body.posts.map((p) => p.id)).toEqual([postId(10)]);
      expect(page3.body.nextCursor).toBeNull();
    });

    it('200: 삭제된 id를 커서로 줘도 동작 (deletion-tolerant)', async () => {
      await Promise.all([1, 2].map((n) => insertPost({ id: postId(n) })));
      // postId(5)는 존재한 적 없음 — 존재 검사가 없으므로 그냥 "그보다 오래된 글"을 준다.
      const { status, body } = await getList({ cursor: postId(5) });
      expect(status).toBe(200);
      expect(body.posts.map((p) => p.id)).toEqual([postId(2), postId(1)]);
    });

    it('200: authorId·plantId 필터 (단독·조합)', async () => {
      const [catalog] = await db
        .insert(plants)
        .values({ name: '필로덴드론', images: [{ key: 'plant-image/p.jpg' }] })
        .returning({ id: plants.id });
      await insertPost({ id: postId(1), authorId: authorAId, plantId: catalog.id });
      await insertPost({ id: postId(2), authorId: authorAId });
      await insertPost({ id: postId(3), authorId: authorBId, plantId: catalog.id });

      const byAuthor = await getList({ authorId: authorAId });
      expect(byAuthor.body.posts.map((p) => p.id)).toEqual([postId(2), postId(1)]);

      const byPlant = await getList({ plantId: catalog.id });
      expect(byPlant.body.posts.map((p) => p.id)).toEqual([postId(3), postId(1)]);

      const combined = await getList({ authorId: authorAId, plantId: catalog.id });
      expect(combined.body.posts.map((p) => p.id)).toEqual([postId(1)]);
    });

    it.each([
      ['limit=0', { limit: '0' }],
      ['limit=51', { limit: '51' }],
      ['limit=abc', { limit: 'abc' }],
      ['cursor 비uuid', { cursor: 'not-a-uuid' }],
      ['plantId 비uuid', { plantId: 'not-a-uuid' }],
      ['authorId 비uuid', { authorId: 'not-a-uuid' }],
    ])('400: %s (Zod)', async (_, query) => {
      const { status } = await getList(query);
      expect(status).toBe(400);
    });
  });

  describe('GET /posts/:id (상세 — 공개)', () => {
    it('200: 토큰 없이 접근 가능 — 목록 필드 + content·updatedAt', async () => {
      await insertPost({
        id: postId(1),
        content: '<p>우리집 <strong>몬스테라</strong></p>',
        excerpt: '우리집 몬스테라',
      });

      const { status, body } = await getDetail(postId(1));
      expect(status).toBe(200);
      expect(body).toEqual({
        id: postId(1),
        title: '제목',
        excerpt: '우리집 몬스테라',
        thumbnailUrl: null,
        author: { id: authorAId, nickname: '작가A' },
        plant: null,
        commentCount: 0,
        content: '<p>우리집 <strong>몬스테라</strong></p>',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
      });
    });

    it('404: 미존재 id → POST_NOT_FOUND', async () => {
      const { status, body } = await getDetail(postId(999));
      expect(status).toBe(404);
      expect(body.errorCode).toBe('POST_NOT_FOUND');
    });

    it('400: 비uuid param (Zod)', async () => {
      const { status } = await getDetail('not-a-uuid');
      expect(status).toBe(400);
    });
  });
});
