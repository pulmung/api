import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
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

  // comment.reader의 users join이 leftJoin이라는 것의 **유일한 방어선**(post-read 전례).
  // innerJoin으로 되돌리면 탈퇴 유저의 댓글이 조용히 사라져 스레드에 구멍이 뚫리고,
  // replyCounts는 users를 안 보므로 "답글 N개"와 실제 개수까지 어긋난다.
  describe('작성자 탈퇴 — 댓글은 남고 author만 null', () => {
    // 전용 유저(지워야 하므로 공유 픽스처 사용 불가) — 가입 후 id를 준다.
    const signupTemp = async (nickname: string) => {
      await request(server).post('/auth/signup').send({
        provider: 'kakao',
        platform: 'ios',
        accessToken: `comment-read-${nickname}`,
        nickname,
      });
      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.nickname, nickname));
      return row.id;
    };

    it('루트 목록: 댓글이 남고 deleted:false + author null', async () => {
      const quitterId = await signupTemp('탈퇴루트');
      await insertComment({ id: commentId(1), authorId: quitterId });
      await db.delete(users).where(eq(users.id, quitterId));

      const { body } = await getRoots();
      // 존재를 먼저 — 사라졌을 때 원인이 읽히도록(post-read와 같은 규율).
      expect(body.comments.map((c) => c.id)).toContain(commentId(1));
      expect(body.comments[0].deleted).toBe(false);
      expect(body.comments[0].author).toBeNull();
      expect(body.comments[0].content).toBe('댓글');
    });

    it('답글 목록: 답글이 남고 author null + replyCount와 실제 개수가 일치한다', async () => {
      const quitterId = await signupTemp('탈퇴답글');
      await insertComment({ id: commentId(2) }); // 루트는 살아있는 유저(댓글러A)
      await insertComment({
        id: commentId(12),
        parentId: commentId(2),
        authorId: quitterId,
      });
      await db.delete(users).where(eq(users.id, quitterId));

      const roots = await getRoots();
      const root = roots.body.comments.find((c) => c.id === commentId(2))!;
      // 목록(leftJoin)과 카운트(users 미조인)가 같은 집합을 봐야 한다 — 한쪽만
      // innerJoin이면 여기서 1 ≠ 0으로 갈린다.
      expect(root.replyCount).toBe(1);

      const replies = await getReplies(commentId(2));
      expect(replies.body.replies.map((r) => r.id)).toEqual([commentId(12)]);
      expect(replies.body.replies[0].author).toBeNull();
    });

    it('멘션된 유저가 탈퇴하면 mentionedUser만 null이 된다(답글 본문은 남는다)', async () => {
      const mentionedId = await signupTemp('탈퇴멘션');
      await insertComment({ id: commentId(3) });
      await insertComment({
        id: commentId(13),
        parentId: commentId(3),
        mentionedUserId: mentionedId,
      });
      await db.delete(users).where(eq(users.id, mentionedId));

      const { body } = await getReplies(commentId(3));
      expect(body.replies.map((r) => r.id)).toEqual([commentId(13)]);
      expect(body.replies[0].mentionedUser).toBeNull();
      // 멘션 유저는 남이므로 작성자(댓글러A)는 그대로다 — 두 축이 독립임을 고정한다.
      expect(body.replies[0].author).toEqual({
        id: userAId,
        nickname: '댓글러A',
      });
    });
  });
});
