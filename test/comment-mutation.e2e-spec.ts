import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { comments, posts, users } from '../src/database/schema';
import { setupE2E } from './helpers/setup-e2e';

const POST_ID = '00000000-0000-7000-8000-999999999999';
const ISO = /^\d{4}-\d{2}-\d{2}T/;

describe('CommentMutation (e2e) — 작성·수정·삭제 + 카운터', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;
  let authorToken: string;
  let authorId: string;
  let otherToken: string;
  let otherId: string;

  beforeAll(async () => {
    ({ app, container, db, pool } = await setupE2E());
    server = app.getHttpServer() as Server;

    const signup = async (accessToken: string, nickname: string) => {
      const res = await request(server)
        .post('/auth/signup')
        .send({ provider: 'kakao', platform: 'ios', accessToken, nickname });
      return (res.body as { accessToken: string }).accessToken;
    };
    authorToken = await signup('comment-mutation-author', '댓글작성자');
    otherToken = await signup('comment-mutation-other', '이웃');

    const rows = await db
      .select({ id: users.id, nickname: users.nickname })
      .from(users);
    authorId = rows.find((r) => r.nickname === '댓글작성자')!.id;
    otherId = rows.find((r) => r.nickname === '이웃')!.id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    // posts 삭제가 comments를 cascade로 쓸어간다 — 매 테스트가 counter 0에서 시작.
    await db.delete(posts);
    await db.insert(posts).values({
      id: POST_ID,
      authorId,
      title: '제목',
      content: '<p>본문</p>',
      excerpt: '본문',
      imageKeys: [],
    });
  });

  // token: null = 무인증 요청 (undefined를 넘기면 JS 기본값이 적용돼 인증돼버린다 — null 센티널).
  const createRoot = async (
    body: Record<string, unknown>,
    token: string | null = authorToken,
    postId: string = POST_ID,
  ) => {
    let req = request(server).post(`/posts/${postId}/comments`);
    if (token !== null) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req.send(body);
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  const createReply = async (
    parentId: string,
    body: Record<string, unknown>,
    token: string | null = authorToken,
  ) => {
    let req = request(server).post(`/comments/${parentId}/replies`);
    if (token !== null) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req.send(body);
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  const patchComment = async (
    id: string,
    body: Record<string, unknown>,
    token: string | null = authorToken,
  ) => {
    let req = request(server).patch(`/comments/${id}`);
    if (token !== null) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req.send(body);
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  const deleteComment = async (
    id: string,
    token: string | null = authorToken,
  ) => {
    let req = request(server).delete(`/comments/${id}`);
    if (token !== null) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  const selectComment = async (id: string) => {
    const [row] = await db.select().from(comments).where(eq(comments.id, id));
    return row;
  };

  const selectPost = async () => {
    const [row] = await db.select().from(posts).where(eq(posts.id, POST_ID));
    return row;
  };

  // 픽스처: API 경유 생성(카운터 경로 포함) — 루트 id를 돌려준다.
  const seedRoot = async (content = '루트 댓글') => {
    const { body } = await createRoot({ content });
    return body.id as string;
  };
  const seedReply = async (parentId: string, content = '답글') => {
    const { body } = await createReply(parentId, { content });
    return body.id as string;
  };

  describe('POST /posts/:postId/comments (루트 작성)', () => {
    it('201: 응답 = 단건 조회 표현 — parentId·mentionedUser는 null', async () => {
      const { status, body } = await createRoot({ content: '첫 댓글' });
      expect(status).toBe(201);
      expect(body).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/i) as unknown,
        parentId: null,
        content: '첫 댓글',
        author: { id: authorId, nickname: '댓글작성자' },
        mentionedUser: null,
        createdAt: expect.stringMatching(ISO) as unknown,
        updatedAt: expect.stringMatching(ISO) as unknown,
      });
    });

    it('201: 본문 앞뒤 공백 trim', async () => {
      const { body } = await createRoot({ content: '  공백 댓글  ' });
      expect(body.content).toBe('공백 댓글');
    });

    it(`201: 본문 2000자(최대) 통과`, async () => {
      const { status } = await createRoot({ content: '가'.repeat(2000) });
      expect(status).toBe(201);
    });

    it('commentCount +1, posts.updatedAt은 불변 ($onUpdate 억제 — 댓글 활동 ≠ 글 수정)', async () => {
      const before = await selectPost();
      await createRoot({ content: '댓글' });

      const after = await selectPost();
      expect(after.commentCount).toBe(1);
      expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    });

    it('404: 비존재 글 → POST_NOT_FOUND (FK 번역, 사전 SELECT 없음)', async () => {
      const { status, body } = await createRoot(
        { content: '댓글' },
        authorToken,
        uuidv7(),
      );
      expect(status).toBe(404);
      expect(body.errorCode).toBe('POST_NOT_FOUND');
    });

    it.each([
      ['본문 누락', {}],
      ['공백뿐', { content: '   ' }],
      ['2001자 (최대 초과)', { content: '가'.repeat(2001) }],
    ])('400: %s (Zod)', async (_, body) => {
      const { status } = await createRoot(body);
      expect(status).toBe(400);
    });

    it('401: 토큰 없음 → UNAUTHENTICATED', async () => {
      const { status, body } = await createRoot({ content: '댓글' }, null);
      expect(status).toBe(401);
      expect(body.errorCode).toBe('UNAUTHENTICATED');
    });
  });

  describe('POST /comments/:id/replies (답글 작성)', () => {
    it('201: 멘션 답글 — parentId는 루트, mentionedUser는 join 해석', async () => {
      const rootId = await seedRoot();

      const { status, body } = await createReply(
        rootId,
        { content: '@지목 답글', mentionedUserId: otherId },
        authorToken,
      );
      expect(status).toBe(201);
      expect(body).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/i) as unknown,
        parentId: rootId,
        content: '@지목 답글',
        author: { id: authorId, nickname: '댓글작성자' },
        mentionedUser: { id: otherId, nickname: '이웃' },
        createdAt: expect.stringMatching(ISO) as unknown,
        updatedAt: expect.stringMatching(ISO) as unknown,
      });
    });

    it('201: 멘션 없는 일반 답글 — mentionedUser null', async () => {
      const rootId = await seedRoot();
      const { status, body } = await createReply(rootId, { content: '답글' });
      expect(status).toBe(201);
      expect(body.mentionedUser).toBeNull();
    });

    it('commentCount는 답글도 센다 — 루트 1 + 답글 1 = 2', async () => {
      const rootId = await seedRoot();
      await seedReply(rootId);
      expect((await selectPost()).commentCount).toBe(2);
    });

    it('404: 비존재 부모 → COMMENT_NOT_FOUND', async () => {
      const { status, body } = await createReply(uuidv7(), { content: '답글' });
      expect(status).toBe(404);
      expect(body.errorCode).toBe('COMMENT_NOT_FOUND');
    });

    it('404: 삭제된(플레이스홀더) 부모에는 답글 불가 — 스레드는 보존, 소생은 금지', async () => {
      const rootId = await seedRoot();
      await seedReply(rootId);
      await deleteComment(rootId); // 답글 있음 → soft delete

      const { status, body } = await createReply(rootId, { content: '늦은 답글' });
      expect(status).toBe(404);
      expect(body.errorCode).toBe('COMMENT_NOT_FOUND');
    });

    it('422: 부모가 답글 → REPLY_DEPTH_EXCEEDED (물리 2계층)', async () => {
      const rootId = await seedRoot();
      const replyId = await seedReply(rootId);

      const { status, body } = await createReply(replyId, {
        content: '답글의 답글',
      });
      expect(status).toBe(422);
      expect(body.errorCode).toBe('REPLY_DEPTH_EXCEEDED');
    });

    it('422: 비존재 멘션 유저 → MENTIONED_USER_NOT_FOUND (FK 번역)', async () => {
      const rootId = await seedRoot();
      const { status, body } = await createReply(rootId, {
        content: '답글',
        mentionedUserId: uuidv7(),
      });
      expect(status).toBe(422);
      expect(body.errorCode).toBe('MENTIONED_USER_NOT_FOUND');
    });

    it('401: 토큰 없음', async () => {
      const rootId = await seedRoot();
      const { status } = await createReply(rootId, { content: '답글' }, null);
      expect(status).toBe(401);
    });
  });

  describe('PATCH /comments/:id (본문 수정)', () => {
    it('200: 응답 = 단건 조회 표현, DB 반영', async () => {
      const rootId = await seedRoot('원래 본문');

      const { status, body } = await patchComment(rootId, {
        content: '고친 본문',
      });
      expect(status).toBe(200);
      expect(body.id).toBe(rootId);
      expect(body.content).toBe('고친 본문');

      const row = await selectComment(rootId);
      expect(row.content).toBe('고친 본문');
    });

    it('404: 타인 댓글 → COMMENT_NOT_FOUND (존재 은닉 — 403 아님)', async () => {
      const rootId = await seedRoot();
      const { status, body } = await patchComment(
        rootId,
        { content: '남의 댓글 수정' },
        otherToken,
      );
      expect(status).toBe(404);
      expect(body.errorCode).toBe('COMMENT_NOT_FOUND');
    });

    it('404: 삭제된(플레이스홀더) 댓글은 수정 불가', async () => {
      const rootId = await seedRoot();
      await seedReply(rootId);
      await deleteComment(rootId); // soft delete

      const { status, body } = await patchComment(rootId, { content: '수정' });
      expect(status).toBe(404);
      expect(body.errorCode).toBe('COMMENT_NOT_FOUND');
    });

    it('404: 비존재 id', async () => {
      const { status } = await patchComment(uuidv7(), { content: '수정' });
      expect(status).toBe(404);
    });

    it('400: 공백뿐 본문 (Zod)', async () => {
      const rootId = await seedRoot();
      const { status } = await patchComment(rootId, { content: '   ' });
      expect(status).toBe(400);
    });

    it('401: 토큰 없음', async () => {
      const rootId = await seedRoot();
      const { status } = await patchComment(rootId, { content: '수정' }, null);
      expect(status).toBe(401);
    });
  });

  describe('DELETE /comments/:id (삭제 삼분기)', () => {
    it('204: 답글 없는 루트 → 하드 삭제, commentCount −1', async () => {
      const rootId = await seedRoot();
      expect((await selectPost()).commentCount).toBe(1);

      const { status } = await deleteComment(rootId);
      expect(status).toBe(204);
      expect(await selectComment(rootId)).toBeUndefined();
      expect((await selectPost()).commentCount).toBe(0);
    });

    it('204: 답글 있는 루트 → soft delete — 본문 즉시 파기·답글 보존·플레이스홀더 전환, commentCount −1', async () => {
      const rootId = await seedRoot('지워질 본문');
      const replyId = await seedReply(rootId);
      expect((await selectPost()).commentCount).toBe(2);

      const { status } = await deleteComment(rootId);
      expect(status).toBe(204);

      // 행은 남되 본문은 파기(개인정보 최소화) — content NULL ⇔ deletedAt 세트.
      const row = await selectComment(rootId);
      expect(row).toBeDefined();
      expect(row.deletedAt).not.toBeNull();
      expect(row.content).toBeNull();
      // 답글 생존 + 카운터는 루트 몫만 감소.
      expect(await selectComment(replyId)).toBeDefined();
      expect((await selectPost()).commentCount).toBe(1);

      // 목록에서는 deleted:true 플레이스홀더로 나타난다.
      const list = await request(server).get(`/posts/${POST_ID}/comments`);
      const items = (list.body as { comments: Record<string, unknown>[] })
        .comments;
      expect(items).toHaveLength(1);
      expect(items[0].deleted).toBe(true);
      expect(items[0].replyCount).toBe(1);
    });

    it('204: 답글 → 하드 삭제, commentCount −1 (살아있는 부모는 그대로)', async () => {
      const rootId = await seedRoot();
      const replyId = await seedReply(rootId);

      const { status } = await deleteComment(replyId);
      expect(status).toBe(204);
      expect(await selectComment(replyId)).toBeUndefined();
      expect(await selectComment(rootId)).toBeDefined();
      expect((await selectPost()).commentCount).toBe(1);
    });

    it('204: 마지막 답글 삭제 → 고아 플레이스홀더도 정리, 카운터는 답글 몫만 감소', async () => {
      const rootId = await seedRoot();
      const replyId = await seedReply(rootId);
      await deleteComment(rootId); // soft delete (카운터 2→1)

      const { status } = await deleteComment(replyId);
      expect(status).toBe(204);
      expect(await selectComment(replyId)).toBeUndefined();
      // 플레이스홀더는 soft delete 시점에 이미 카운터에서 빠졌다 — 정리는 무변동.
      expect(await selectComment(rootId)).toBeUndefined();
      expect((await selectPost()).commentCount).toBe(0);
    });

    it('404: 타인 댓글 → COMMENT_NOT_FOUND (존재 은닉)', async () => {
      const rootId = await seedRoot();
      const { status, body } = await deleteComment(rootId, otherToken);
      expect(status).toBe(404);
      expect(body.errorCode).toBe('COMMENT_NOT_FOUND');
      expect((await selectPost()).commentCount).toBe(1);
    });

    it('404: 이미 삭제된(soft) 댓글 재삭제 — 카운터 이중 감소 없음', async () => {
      const rootId = await seedRoot();
      await seedReply(rootId);
      await deleteComment(rootId); // soft delete (카운터 2→1)

      const { status, body } = await deleteComment(rootId);
      expect(status).toBe(404);
      expect(body.errorCode).toBe('COMMENT_NOT_FOUND');
      expect((await selectPost()).commentCount).toBe(1);
    });

    it('401: 토큰 없음', async () => {
      const rootId = await seedRoot();
      const { status } = await deleteComment(rootId, null);
      expect(status).toBe(401);
    });
  });

  describe('글 삭제 cascade', () => {
    it('글 삭제 → 루트·답글 전멸, self-FK 무충돌 (NO ACTION 문장 끝 검사 실증)', async () => {
      const rootId = await seedRoot();
      await seedReply(rootId);
      const another = await seedRoot('둘째 루트');
      await seedReply(another);

      const res = await request(server)
        .delete(`/posts/${POST_ID}`)
        .set('Authorization', `Bearer ${authorToken}`);
      expect(res.status).toBe(204);

      expect(await db.select().from(comments)).toEqual([]);
    });
  });
});
