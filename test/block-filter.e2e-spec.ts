import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { comments, posts, userBlocks, users } from '../src/database/schema';
import { setupE2E } from './helpers/setup-e2e';

/**
 * 차단 가시성 필터의 회귀 방어선 — `excludeBlocked()`가 목록 읽기 경로에서 누락되면
 * **아무 신호 없이 fail-open**한다(조용히 차단된 유저의 콘텐츠가 노출된다). 이 파일이
 * 없으면 필터가 죽어도 모든 테스트가 통과한다 — 그래서 전용 테스트가 필수다
 * (transactional.e2e-spec.ts가 CLS 배선에 대해 같은 역할을 하는 것과 같은 결).
 *
 * 특히 **양방향**을 검증한다: 차단당한 쪽에서도 상대가 사라져야 한다. 정방향만 도는
 * 구현은 절반이 맞아서 눈으로는 통과처럼 보인다.
 */
const POST_A = '00000000-0000-7000-8000-00000000000a'; // 앨리스 작성
const POST_B = '00000000-0000-7000-8000-00000000000b'; // 보브 작성
const ROOT_A = '00000000-0000-7000-8000-0000000000a1'; // 앨리스 루트 댓글
const ROOT_B = '00000000-0000-7000-8000-0000000000b1'; // 보브 루트 댓글
const REPLY_A = '00000000-0000-7000-8000-0000000000a2'; // ROOT_A에 앨리스 답글
const REPLY_B = '00000000-0000-7000-8000-0000000000b2'; // ROOT_A에 보브 답글

type PostListBody = { posts: Array<{ id: string }>; nextCursor: string | null };
type CommentListBody = {
  comments: Array<{ id: string; replyCount: number }>;
  nextCursor: string | null;
};
type ReplyListBody = {
  replies: Array<{ id: string }>;
  nextCursor: string | null;
};

describe('BlockFilter (e2e) — 차단이 목록 읽기에서 양방향으로 걸러진다', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;
  let aliceToken: string;
  let aliceId: string;
  let bobToken: string;
  let bobId: string;

  beforeAll(async () => {
    ({ app, container, db, pool } = await setupE2E());
    server = app.getHttpServer() as Server;

    const signup = async (accessToken: string, nickname: string) => {
      const res = await request(server)
        .post('/auth/signup')
        .send({ provider: 'kakao', platform: 'ios', accessToken, nickname });
      return (res.body as { accessToken: string }).accessToken;
    };
    aliceToken = await signup('filter-alice', '앨리스');
    bobToken = await signup('filter-bob', '보브');

    const rows = await db
      .select({ id: users.id, nickname: users.nickname })
      .from(users);
    aliceId = rows.find((r) => r.nickname === '앨리스')!.id;
    bobId = rows.find((r) => r.nickname === '보브')!.id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    await db.delete(userBlocks);
    // posts 삭제가 comments를 cascade로 쓸어간다(루트+답글 한 문장 — self-FK 무충돌).
    await db.delete(posts);

    const post = (id: string, authorId: string) => ({
      id,
      authorId,
      title: '제목',
      content: '<p>본문</p>',
      excerpt: '본문',
      imageKeys: [],
    });
    await db.insert(posts).values([post(POST_A, aliceId), post(POST_B, bobId)]);

    // POST_A에 양쪽의 루트 댓글 + ROOT_A에 양쪽의 답글.
    await db.insert(comments).values([
      { id: ROOT_A, postId: POST_A, authorId: aliceId, content: '앨리스 루트' },
      { id: ROOT_B, postId: POST_A, authorId: bobId, content: '보브 루트' },
    ]);
    await db.insert(comments).values([
      {
        id: REPLY_A,
        postId: POST_A,
        parentId: ROOT_A,
        authorId: aliceId,
        content: '앨리스 답글',
      },
      {
        id: REPLY_B,
        postId: POST_A,
        parentId: ROOT_A,
        authorId: bobId,
        content: '보브 답글',
      },
    ]);
  });

  // 앨리스 → 보브 단방향 행 하나. 효과는 양방향이어야 한다.
  const aliceBlocksBob = () =>
    db.insert(userBlocks).values({ blockerId: aliceId, blockedId: bobId });

  // token: null = 무인증(익명 뷰어 — 차단 필터가 적용되지 않아야 한다).
  const get = async (path: string, token: string | null) => {
    let req = request(server).get(path);
    if (token !== null) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return {
      status: res.status,
      headers: res.headers as Record<string, string>,
      body: res.body as unknown,
    };
  };

  const postIds = (body: unknown) =>
    (body as PostListBody).posts.map((p) => p.id);
  const commentIds = (body: unknown) =>
    (body as CommentListBody).comments.map((c) => c.id);
  const replyIds = (body: unknown) =>
    (body as ReplyListBody).replies.map((r) => r.id);

  describe('GET /posts (목록)', () => {
    it('차단 전에는 서로의 글이 보인다', async () => {
      const { body } = await get('/posts', aliceToken);
      expect(postIds(body).sort()).toEqual([POST_A, POST_B]);
    });

    it('차단한 쪽(앨리스)의 목록에서 상대 글이 사라진다', async () => {
      await aliceBlocksBob();
      const { body } = await get('/posts', aliceToken);
      expect(postIds(body)).toEqual([POST_A]);
    });

    // ★ 핵심 — 저장은 단방향(앨리스→보브)인데 효과는 양방향이어야 한다.
    // 이게 빠지면 차단당한 쪽이 여전히 상대 글을 보고 댓글을 달 수 있어 차단이
    // 괴롭힘 방어로 기능하지 않는다.
    it('차단당한 쪽(보브)의 목록에서도 상대 글이 사라진다 (역방향)', async () => {
      await aliceBlocksBob();
      const { body } = await get('/posts', bobToken);
      expect(postIds(body)).toEqual([POST_B]);
    });

    it('익명 뷰어에게는 필터가 적용되지 않는다 (차단은 뷰어별 개념)', async () => {
      await aliceBlocksBob();
      const { body } = await get('/posts', null);
      expect(postIds(body).sort()).toEqual([POST_A, POST_B]);
    });

    it('authorId 필터와 조합해도 걸러진다 (프로필 글 목록)', async () => {
      await aliceBlocksBob();
      const { body } = await get(`/posts?authorId=${bobId}`, aliceToken);
      expect(postIds(body)).toEqual([]);
    });

    // 페이지 크기 계약: 필터가 WHERE에 있으므로 DB가 통과 행으로 limit을 채운다.
    // 앱에서 후처리로 걸러내면 limit=1 요청에 0건이 나올 수 있다.
    it('limit이 필터 통과 행 기준으로 채워진다 (앱 후처리면 깨진다)', async () => {
      await aliceBlocksBob();
      const { body } = await get('/posts?limit=1', aliceToken);
      expect(postIds(body)).toEqual([POST_A]);
      expect((body as PostListBody).nextCursor).toBeNull();
    });
  });

  describe('GET /posts/:id (상세) — 필터하지 않는다', () => {
    // 합의된 결정(a): 차단은 목록 필터일 뿐이다. 공개 게시판이라 로그아웃으로 우회
    // 가능하므로 상세를 막아도 보안 경계가 아니고, 복잡도만 늘어난다.
    it('차단한 상대의 글도 상세 직접 접근은 200', async () => {
      await aliceBlocksBob();
      const { status } = await get(`/posts/${POST_B}`, aliceToken);
      expect(status).toBe(200);
    });
  });

  describe('GET /posts/:postId/comments (루트 목록)', () => {
    it('차단 전에는 양쪽 루트가 보인다', async () => {
      const { body } = await get(`/posts/${POST_A}/comments`, aliceToken);
      expect(commentIds(body)).toEqual([ROOT_A, ROOT_B]);
    });

    it('차단하면 상대 루트가 사라진다 (양방향)', async () => {
      await aliceBlocksBob();
      expect(
        commentIds((await get(`/posts/${POST_A}/comments`, aliceToken)).body),
      ).toEqual([ROOT_A]);
      expect(
        commentIds((await get(`/posts/${POST_A}/comments`, bobToken)).body),
      ).toEqual([ROOT_B]);
    });

    it('익명 뷰어에게는 양쪽 다 보인다', async () => {
      await aliceBlocksBob();
      const { body } = await get(`/posts/${POST_A}/comments`, null);
      expect(commentIds(body)).toEqual([ROOT_A, ROOT_B]);
    });

    // replyCount는 실시간 집계라 필터가 공짜다 — commentCount(비정규화)와의 의도적
    // 비대칭. "답글 N개" 버튼을 눌러 다른 수가 나오면 같은 화면 안에서 즉시 보인다.
    it('replyCount가 차단을 반영한다 (목록과 같은 조건)', async () => {
      const before = (await get(`/posts/${POST_A}/comments`, aliceToken))
        .body as CommentListBody;
      expect(before.comments.find((c) => c.id === ROOT_A)!.replyCount).toBe(2);

      await aliceBlocksBob();
      const after = (await get(`/posts/${POST_A}/comments`, aliceToken))
        .body as CommentListBody;
      expect(after.comments.find((c) => c.id === ROOT_A)!.replyCount).toBe(1);
    });

    it('뷰어별 응답이라 공유 캐시가 금지된다', async () => {
      const { headers } = await get(`/posts/${POST_A}/comments`, aliceToken);
      expect(headers['cache-control']).toBe('private, no-store');
      expect(headers['vary']).toContain('Authorization');
    });
  });

  describe('GET /comments/:id/replies (답글 목록)', () => {
    it('차단하면 상대 답글이 사라진다 (양방향)', async () => {
      await aliceBlocksBob();
      expect(
        replyIds((await get(`/comments/${ROOT_A}/replies`, aliceToken)).body),
      ).toEqual([REPLY_A]);
      expect(
        replyIds((await get(`/comments/${ROOT_A}/replies`, bobToken)).body),
      ).toEqual([REPLY_B]);
    });

    it('익명 뷰어에게는 양쪽 다 보인다', async () => {
      await aliceBlocksBob();
      const { body } = await get(`/comments/${ROOT_A}/replies`, null);
      expect(replyIds(body).sort()).toEqual([REPLY_A, REPLY_B]);
    });

    // 필터로 0행이 되어도 "빈 스레드"이지 404가 아니다 — 루트는 실존한다.
    it('필터로 모든 답글이 빠져도 200 빈 목록 (404 아님)', async () => {
      await db.delete(comments).where(eq(comments.id, REPLY_A));
      await aliceBlocksBob();
      const { status, body } = await get(
        `/comments/${ROOT_A}/replies`,
        aliceToken,
      );
      expect(status).toBe(200);
      expect(replyIds(body)).toEqual([]);
    });
  });

  /**
   * `excludeBlocked`는 anti-join(NOT EXISTS 2개)이라 `author_id IS NULL`에 NULL-safe다 —
   * 등호가 UNKNOWN → 서브쿼리 0행 → NOT EXISTS TRUE → 행 통과.
   * 누군가 이걸 `NOT IN (서브쿼리)`로 "단순화"하면 NULL 하나가 전체를 UNKNOWN으로
   * 만들어 **목록이 통째로 비는데**, 그 회귀를 잡는 건 이 describe뿐이다.
   */
  describe('작성자 탈퇴(author_id NULL)는 차단 필터를 통과한다', () => {
    const ROOT_C = '00000000-0000-7000-8000-0000000000c1';
    const REPLY_C = '00000000-0000-7000-8000-0000000000c2';

    // 전용 유저 캐롤을 만들고 → 앨리스가 차단 → **남의 글(POST_A)에** 댓글을 남기고 → 탈퇴.
    // 공유 픽스처(보브)를 지우면 바깥 beforeEach의 POST_B 삽입이 FK로 깨져 파일 전체가
    // 실행 순서에 의존하게 된다(report 스펙이 세운 규율).
    // 글이 아니라 댓글로 검증하는 이유: 탈퇴하면 자기 글은 cascade로 사라져 author_id NULL인
    // 글이 존재할 수 없다. 이 상태는 남의 글에 단 댓글에서만 생긴다(post.table.ts).
    beforeEach(async () => {
      // 앨리스→보브 차단을 함께 걸어 **필터가 실제로 켜진 상태**임을 보장한다 —
      // 필터가 통째로 죽어도 통과하는 테스트가 되면 안 되므로.
      await aliceBlocksBob();

      const res = await request(server).post('/auth/signup').send({
        provider: 'kakao',
        platform: 'ios',
        accessToken: 'filter-carol',
        nickname: '캐롤',
      });
      expect(res.status).toBe(201);
      const [carol] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.nickname, '캐롤'));

      await db
        .insert(userBlocks)
        .values({ blockerId: aliceId, blockedId: carol.id });
      await db.insert(comments).values({
        id: ROOT_C,
        postId: POST_A,
        authorId: carol.id,
        content: '캐롤 루트',
      });
      await db.insert(comments).values({
        id: REPLY_C,
        postId: POST_A,
        parentId: ROOT_A,
        authorId: carol.id,
        content: '캐롤 답글',
      });

      // 탈퇴 — 두 댓글의 author_id가 NULL이 되고, 앨리스→캐롤 차단 행은 cascade로 사라진다.
      await db.delete(users).where(eq(users.id, carol.id));
    });

    it('차단했던 상대가 탈퇴하면 그가 남긴 루트·답글이 다시 보인다', async () => {
      const roots = await get(`/posts/${POST_A}/comments`, aliceToken);
      expect(commentIds(roots.body)).toContain(ROOT_C);
      // 살아있는 차단(앨리스→보브)은 그대로 걸린다 — 필터가 켜져 있다는 증거.
      expect(commentIds(roots.body)).not.toContain(ROOT_B);

      const replies = await get(`/comments/${ROOT_A}/replies`, aliceToken);
      expect(replyIds(replies.body)).toContain(REPLY_C);
      expect(replyIds(replies.body)).not.toContain(REPLY_B);
    });

    it('replyCount도 탈퇴자의 답글을 센다(목록과 같은 집합)', async () => {
      const roots = await get(`/posts/${POST_A}/comments`, aliceToken);
      const root = (roots.body as CommentListBody).comments.find(
        (c) => c.id === ROOT_A,
      )!;
      // 앨리스 답글 + 캐롤(탈퇴) 답글 = 2. 보브 답글은 차단으로 빠진다.
      expect(root.replyCount).toBe(2);
    });
  });
});
