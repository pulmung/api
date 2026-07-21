import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { plants, posts, users, type NewPost } from '../src/database/schema';
import { setupE2E, FakeFileStorage } from './helpers/setup-e2e';
import { TEST_FILE_BASE_URL } from './helpers/test-env';

const postId = (n: number) =>
  `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const IMG_KEY = 'post-image/0198c5b2-2f74-7abc-8def-000000000009.jpg';
const imgSrc = (key: string) => `${TEST_FILE_BASE_URL}/${key}`;

describe('PostMutation (e2e) — PATCH·DELETE /posts/:id', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;
  let fakeStorage: FakeFileStorage;
  let authorToken: string;
  let authorId: string;
  let otherToken: string;

  beforeAll(async () => {
    ({ app, container, db, pool, fakeStorage } = await setupE2E());
    server = app.getHttpServer() as Server;

    const signup = async (accessToken: string, nickname: string) => {
      const res = await request(server)
        .post('/auth/signup')
        .send({ provider: 'kakao', platform: 'ios', accessToken, nickname });
      return (res.body as { accessToken: string }).accessToken;
    };
    authorToken = await signup('post-mutation-author', '글쓴이');
    otherToken = await signup('post-mutation-other', '이웃');

    const rows = await db
      .select({ id: users.id, nickname: users.nickname })
      .from(users);
    authorId = rows.find((r) => r.nickname === '글쓴이')!.id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    await db.delete(posts);
    await db.delete(plants);
    fakeStorage.missingKeys.clear();
  });

  // 파생 컬럼(excerpt·imageKeys)은 NOT NULL — 픽스처도 쓰기 경로의 계약대로 명시 공급.
  const insertPost = (overrides: Partial<NewPost> & { id: string }) =>
    db.insert(posts).values({
      authorId,
      title: '원래 제목',
      content: `<p>원래 본문</p><img src="${imgSrc(IMG_KEY)}" />`,
      excerpt: '원래 본문',
      thumbnailKey: IMG_KEY,
      imageKeys: [IMG_KEY],
      ...overrides,
    });

  const selectPost = async (id: string) => {
    const [row] = await db.select().from(posts).where(eq(posts.id, id));
    return row;
  };

  // token: null = 무인증 요청 (undefined를 넘기면 JS 기본값이 적용돼 인증돼버린다 — null 센티널).
  const patchPost = async (
    id: string,
    body: Record<string, unknown>,
    token: string | null = authorToken,
  ) => {
    let req = request(server).patch(`/posts/${id}`);
    if (token !== null) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req.send(body);
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  const deletePost = async (id: string, token: string | null = authorToken) => {
    let req = request(server).delete(`/posts/${id}`);
    if (token !== null) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  describe('PATCH /posts/:id', () => {
    it('200: title-only 패치 — 본문·파생 컬럼은 그대로(재계산 없음)', async () => {
      await insertPost({ id: postId(1) });

      const { status, body } = await patchPost(postId(1), {
        title: '새 제목',
      });
      expect(status).toBe(200);
      expect(body.title).toBe('새 제목');

      const row = await selectPost(postId(1));
      expect(row.title).toBe('새 제목');
      // 파생 4필드(content·excerpt·thumbnailKey·imageKeys)가 건드려지지 않았다.
      expect(row.content).toBe(`<p>원래 본문</p><img src="${imgSrc(IMG_KEY)}" />`);
      expect(row.excerpt).toBe('원래 본문');
      expect(row.thumbnailKey).toBe(IMG_KEY);
      expect(row.imageKeys).toEqual([IMG_KEY]);
    });

    it('200: content 패치 — 재정화 + 파생 4필드 원자 재계산 (이미지 제거 → 썸네일 null)', async () => {
      await insertPost({ id: postId(1) });

      const { status, body } = await patchPost(postId(1), {
        content: '<p>고쳐 쓴 <b>본문</b></p>',
      });
      expect(status).toBe(200);
      expect(body.content).toBe('<p>고쳐 쓴 <strong>본문</strong></p>');
      expect(body.excerpt).toBe('고쳐 쓴 본문');
      expect(body.thumbnailUrl).toBeNull();

      const row = await selectPost(postId(1));
      expect(row.excerpt).toBe('고쳐 쓴 본문');
      expect(row.thumbnailKey).toBeNull();
      expect(row.imageKeys).toEqual([]);
      expect(row.title).toBe('원래 제목'); // 미제공 필드는 불변.
    });

    it('200: plantId 값 = 태그 교체, null = 태그 해제', async () => {
      const [catalog] = await db
        .insert(plants)
        .values({ name: '몬스테라 알보', images: [{ key: 'plant-image/c.jpg' }] })
        .returning({ id: plants.id });
      await insertPost({ id: postId(1) });

      const tagged = await patchPost(postId(1), { plantId: catalog.id });
      expect(tagged.body.plant).toEqual({ id: catalog.id, name: '몬스테라 알보' });

      const untagged = await patchPost(postId(1), { plantId: null });
      expect(untagged.status).toBe(200);
      expect(untagged.body.plant).toBeNull();
      expect((await selectPost(postId(1))).plantId).toBeNull();
    });

    it('400: 빈 패치 {} — no-op은 클라 버그 (Zod refine)', async () => {
      await insertPost({ id: postId(1) });
      const { status } = await patchPost(postId(1), {});
      expect(status).toBe(400);
    });

    it('401: 토큰 없음', async () => {
      const { status } = await patchPost(postId(1), { title: '새 제목' }, null);
      expect(status).toBe(401);
    });

    it('404: 타인 글 — 비존재와 구분 불가(존재 은닉), 행 불변', async () => {
      await insertPost({ id: postId(1) });

      const { status, body } = await patchPost(
        postId(1),
        { title: '탈취 시도' },
        otherToken,
      );
      expect(status).toBe(404);
      expect(body.errorCode).toBe('POST_NOT_FOUND');
      expect((await selectPost(postId(1))).title).toBe('원래 제목');
    });

    it('404: 미존재 id → POST_NOT_FOUND', async () => {
      const { status, body } = await patchPost(postId(999), { title: '새 제목' });
      expect(status).toBe(404);
      expect(body.errorCode).toBe('POST_NOT_FOUND');
    });

    it('404 > 422: 타인 글 + 비존재 plantId — 0행이라 FK 미평가, 404가 이긴다', async () => {
      await insertPost({ id: postId(1) });
      const { status, body } = await patchPost(
        postId(1),
        { plantId: uuidv7() },
        otherToken,
      );
      expect(status).toBe(404);
      expect(body.errorCode).toBe('POST_NOT_FOUND');
    });

    it('422: 내 글 + 비존재 plantId → REFERENCED_PLANT_NOT_FOUND', async () => {
      await insertPost({ id: postId(1) });
      const { status, body } = await patchPost(postId(1), { plantId: uuidv7() });
      expect(status).toBe(422);
      expect(body.errorCode).toBe('REFERENCED_PLANT_NOT_FOUND');
    });

    it('422: content의 이미지가 미업로드 → POST_IMAGE_NOT_UPLOADED (제공 시에만 head 검증)', async () => {
      await insertPost({ id: postId(1) });
      const newKey = 'post-image/0198c5b2-2f74-7abc-8def-00000000000a.jpg';
      fakeStorage.missingKeys.add(newKey);

      const { status, body } = await patchPost(postId(1), {
        content: `<p>a</p><img src="${imgSrc(newKey)}" />`,
      });
      expect(status).toBe(422);
      expect(body.errorCode).toBe('POST_IMAGE_NOT_UPLOADED');

      // 기존 이미지(IMG_KEY)가 missingKeys에 있어도 content 미제공 패치는 재검증하지 않는다.
      fakeStorage.missingKeys.add(IMG_KEY);
      const titleOnly = await patchPost(postId(1), { title: '새 제목' });
      expect(titleOnly.status).toBe(200);
    });

    it('422: content가 외부 이미지 참조 → INVALID_POST_IMAGE_SRC', async () => {
      await insertPost({ id: postId(1) });
      const { status, body } = await patchPost(postId(1), {
        content: '<p>a</p><img src="https://evil.example/x.jpg" />',
      });
      expect(status).toBe(422);
      expect(body.errorCode).toBe('INVALID_POST_IMAGE_SRC');
    });
  });

  describe('DELETE /posts/:id', () => {
    it('204: 삭제 — 본문 없는 응답, 행 소멸, 재삭제는 404', async () => {
      await insertPost({ id: postId(1) });

      const first = await deletePost(postId(1));
      expect(first.status).toBe(204);
      expect(first.body).toEqual({});
      expect(await selectPost(postId(1))).toBeUndefined();

      const second = await deletePost(postId(1));
      expect(second.status).toBe(404);
      expect(second.body.errorCode).toBe('POST_NOT_FOUND');
    });

    it('401: 토큰 없음', async () => {
      const { status } = await deletePost(postId(1), null);
      expect(status).toBe(401);
    });

    it('404: 타인 글 — 존재 은닉, 행 보존', async () => {
      await insertPost({ id: postId(1) });

      const { status, body } = await deletePost(postId(1), otherToken);
      expect(status).toBe(404);
      expect(body.errorCode).toBe('POST_NOT_FOUND');
      expect(await selectPost(postId(1))).toBeDefined();
    });
  });
});
