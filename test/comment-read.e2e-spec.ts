import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { DrizzleDB } from '../src/database/drizzle.constants';
import {
  comments,
  posts,
  users,
  type NewComment,
} from '../src/database/schema';
import { setupE2E } from './helpers/setup-e2e';

// 커서 테스트의 순서 결정성을 위한 명시적 uuid 픽스처 (post-read 전례).
const commentId = (n: number) =>
  `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const POST_ID = '00000000-0000-7000-8000-999999999999';

type CommentListBody = {
  comments: Array<{ id: string } & Record<string, unknown>>;
  nextCursor: string | null;
};
type ReplyListBody = {
  replies: Array<{ id: string } & Record<string, unknown>>;
  nextCursor: string | null;
};

describe('CommentRead (e2e) — 공개 댓글 읽기', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    ({ app, container, db, pool } = await setupE2E());
    server = app.getHttpServer() as Server;

    // 읽기는 공개(토큰 불필요)지만, 작성자 표시·멘션 해석 검증용으로 유저 2명 필요.
    const signup = (accessToken: string, nickname: string) =>
      request(server)
        .post('/auth/signup')
        .send({ provider: 'kakao', platform: 'ios', accessToken, nickname });
    await signup('comment-read-user-a', '댓글러A');
    await signup('comment-read-user-b', '댓글러B');

    const rows = await db
      .select({ id: users.id, nickname: users.nickname })
      .from(users);
    userAId = rows.find((r) => r.nickname === '댓글러A')!.id;
    userBId = rows.find((r) => r.nickname === '댓글러B')!.id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    // posts 삭제가 comments를 cascade로 쓸어간다(루트+답글 한 문장 — self-FK 무충돌).
    await db.delete(posts);
    await db.insert(posts).values({
      id: POST_ID,
      authorId: userAId,
      title: '제목',
      content: '<p>본문</p>',
      excerpt: '본문',
      imageKeys: [],
    });
  });

  // 읽기 픽스처는 db 직삽(카운터 무관) — soft-deleted는 deletedAt + content null로 표현.
  const insertComment = (overrides: Partial<NewComment> & { id: string }) =>
    db.insert(comments).values({
      postId: POST_ID,
      authorId: userAId,
      content: '댓글',
      ...overrides,
    });

  const getRoots = async (
    postId: string = POST_ID,
    query: Record<string, string> = {},
  ) => {
    const res = await request(server)
      .get(`/posts/${postId}/comments`)
      .query(query);
    return { status: res.status, body: res.body as CommentListBody };
  };

  const getReplies = async (
    rootId: string,
    query: Record<string, string> = {},
  ) => {
    const res = await request(server)
      .get(`/comments/${rootId}/replies`)
      .query(query);
    return { status: res.status, body: res.body as ReplyListBody };
  };

  describe('GET /posts/:postId/comments (루트 목록 — 공개)', () => {
    it('200: 토큰 없이 접근 가능, 빈 목록 = { comments: [], nextCursor: null }', async () => {
      const { status, body } = await getRoots();
      expect(status).toBe(200);
      expect(body).toEqual({ comments: [], nextCursor: null });
    });

    it('404: 비존재 글 → POST_NOT_FOUND (빈 글과 구분)', async () => {
      const { status, body } = await getRoots(commentId(999));
      expect(status).toBe(404);
      expect((body as Record<string, unknown>).errorCode).toBe(
        'POST_NOT_FOUND',
      );
    });

    it('200: 살아있는 아이템 형태 — deleted:false + 본문·작성자·replyCount (내부 컬럼 누출 없음)', async () => {
      await insertComment({ id: commentId(1), content: '첫 댓글' });

      const { body } = await getRoots();
      // toEqual = 정확 일치 — deletedAt·postId·parentId 키가 응답에 없음도 함께 증명.
      expect(body.comments).toEqual([
        {
          deleted: false,
          id: commentId(1),
          content: '첫 댓글',
          author: { id: userAId, nickname: '댓글러A' },
          replyCount: 0,
          createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
          updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
        },
      ]);
    });

    it('200: 삭제된 댓글은 deleted:true 플레이스홀더 — content·author·updatedAt 키 자체가 없다', async () => {
      await insertComment({
        id: commentId(1),
        content: null,
        deletedAt: new Date(),
      });
      await insertComment({
        id: commentId(2),
        parentId: commentId(1),
        authorId: userBId,
        content: '남은 답글',
      });

      const { body } = await getRoots();
      expect(body.comments).toEqual([
        {
          deleted: true,
          id: commentId(1),
          replyCount: 1,
          createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
        },
      ]);
    });

    it('200: 답글은 루트 목록에 섞이지 않고 replyCount로만 나타난다', async () => {
      await insertComment({ id: commentId(1) });
      await insertComment({ id: commentId(2) });
      await insertComment({ id: commentId(11), parentId: commentId(1) });
      await insertComment({ id: commentId(12), parentId: commentId(1) });

      const { body } = await getRoots();
      expect(body.comments.map((c) => c.id)).toEqual([
        commentId(1),
        commentId(2),
      ]);
      expect(body.comments.map((c) => c.replyCount)).toEqual([2, 0]);
    });

    it('200: limit=2 커서 워크 — 등록순(ASC) 2/2/1, 무중복·무누락, 끝에서 null', async () => {
      await Promise.all(
        [1, 2, 3, 4, 5].map((n) => insertComment({ id: commentId(n * 10) })),
      );

      const page1 = await getRoots(POST_ID, { limit: '2' });
      expect(page1.body.comments.map((c) => c.id)).toEqual([
        commentId(10),
        commentId(20),
      ]);
      expect(page1.body.nextCursor).toBe(commentId(20));

      const page2 = await getRoots(POST_ID, {
        limit: '2',
        cursor: page1.body.nextCursor!,
      });
      expect(page2.body.comments.map((c) => c.id)).toEqual([
        commentId(30),
        commentId(40),
      ]);

      const page3 = await getRoots(POST_ID, {
        limit: '2',
        cursor: page2.body.nextCursor!,
      });
      expect(page3.body.comments.map((c) => c.id)).toEqual([commentId(50)]);
      expect(page3.body.nextCursor).toBeNull();
    });

    it('200: 삭제된 id를 커서로 줘도 동작 (deletion-tolerant)', async () => {
      await insertComment({ id: commentId(10) });
      await insertComment({ id: commentId(30) });
      // commentId(20)은 존재한 적 없음 — 그냥 "그보다 새 댓글"을 준다.
      const { status, body } = await getRoots(POST_ID, {
        cursor: commentId(20),
      });
      expect(status).toBe(200);
      expect(body.comments.map((c) => c.id)).toEqual([commentId(30)]);
    });

    it.each([
      ['limit=0', { limit: '0' }],
      ['limit=51', { limit: '51' }],
      ['limit=abc', { limit: 'abc' }],
      ['cursor 비uuid', { cursor: 'not-a-uuid' }],
    ])('400: %s (Zod)', async (_, query) => {
      const { status } = await getRoots(POST_ID, query);
      expect(status).toBe(400);
    });
  });

  describe('GET /comments/:id/replies (답글 목록 — 공개)', () => {
    it('200: 아이템 형태 — 멘션 해석(join)·없으면 null (내부 컬럼 누출 없음)', async () => {
      await insertComment({ id: commentId(1) });
      await insertComment({
        id: commentId(11),
        parentId: commentId(1),
        authorId: userBId,
        content: '일반 답글',
      });
      await insertComment({
        id: commentId(12),
        parentId: commentId(1),
        content: '지목 답글',
        mentionedUserId: userBId,
      });

      const { status, body } = await getReplies(commentId(1));
      expect(status).toBe(200);
      expect(body.replies).toEqual([
        {
          id: commentId(11),
          content: '일반 답글',
          author: { id: userBId, nickname: '댓글러B' },
          mentionedUser: null,
          createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
          updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
        },
        {
          id: commentId(12),
          content: '지목 답글',
          author: { id: userAId, nickname: '댓글러A' },
          mentionedUser: { id: userBId, nickname: '댓글러B' },
          createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
          updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
        },
      ]);
    });

    it('200: 답글 없는 루트 = 빈 목록 (404 아님)', async () => {
      await insertComment({ id: commentId(1) });
      const { status, body } = await getReplies(commentId(1));
      expect(status).toBe(200);
      expect(body).toEqual({ replies: [], nextCursor: null });
    });

    it('200: 삭제된(플레이스홀더) 루트의 답글도 열람 가능 — 스레드 보존', async () => {
      await insertComment({
        id: commentId(1),
        content: null,
        deletedAt: new Date(),
      });
      await insertComment({
        id: commentId(11),
        parentId: commentId(1),
        authorId: userBId,
        content: '보존된 답글',
      });

      const { status, body } = await getReplies(commentId(1));
      expect(status).toBe(200);
      expect(body.replies.map((r) => r.content)).toEqual(['보존된 답글']);
    });

    it('200: limit=2 커서 워크 — 등록순(ASC) 2/1', async () => {
      await insertComment({ id: commentId(1) });
      await Promise.all(
        [11, 12, 13].map((n) =>
          insertComment({ id: commentId(n), parentId: commentId(1) }),
        ),
      );

      const page1 = await getReplies(commentId(1), { limit: '2' });
      expect(page1.body.replies.map((r) => r.id)).toEqual([
        commentId(11),
        commentId(12),
      ]);
      expect(page1.body.nextCursor).toBe(commentId(12));

      const page2 = await getReplies(commentId(1), {
        limit: '2',
        cursor: page1.body.nextCursor!,
      });
      expect(page2.body.replies.map((r) => r.id)).toEqual([commentId(13)]);
      expect(page2.body.nextCursor).toBeNull();
    });

    it('404: 답글 id를 대상으로 주면 COMMENT_NOT_FOUND — 루트만 스레드 앵커다', async () => {
      await insertComment({ id: commentId(1) });
      await insertComment({ id: commentId(11), parentId: commentId(1) });

      const { status, body } = await getReplies(commentId(11));
      expect(status).toBe(404);
      expect((body as Record<string, unknown>).errorCode).toBe(
        'COMMENT_NOT_FOUND',
      );
    });

    it('404: 비존재 id → COMMENT_NOT_FOUND', async () => {
      const { status, body } = await getReplies(commentId(999));
      expect(status).toBe(404);
      expect((body as Record<string, unknown>).errorCode).toBe(
        'COMMENT_NOT_FOUND',
      );
    });
  });
});
