import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { DrizzleDB } from '../src/database/drizzle.constants';
import {
  comments,
  plants,
  postLikes,
  posts,
  sessions,
  userBlocks,
  userPlants,
  users,
  waterings,
} from '../src/database/schema';
import { setupE2E } from './helpers/setup-e2e';

/**
 * 회원탈퇴 — `DELETE /users/me`.
 *
 * 이 스펙이 지키는 계약은 둘이다:
 * ① **무엇이 사라지고 무엇이 남는가** — user.table.ts의 전파 맵이 코드로 고정된다.
 *    특히 "글·댓글은 남고 작성자만 사라진다"는 정책 결정이라 되돌리기 쉽다.
 * ② **likeCount 정확성** — post_likes를 DB cascade에 맡기면 쓰기 어댑터를 우회해
 *    카운터가 조용히 어긋난다. DeleteUserUseCase가 명시적으로 지우는 유일한 이유이고,
 *    그 오케스트레이션이 죽어도 API는 여전히 204를 반환한다(침묵하는 실패).
 *
 * 매 테스트가 **전용 유저**를 만들어 지운다 — 공유 유저를 지우면 다른 케이스의 토큰이
 * 죽어 실행 순서에 의존하게 된다(report.e2e-spec.ts가 세운 규율).
 */
const OTHER_POST_ID = '00000000-0000-7000-8000-00000000000a';
const QUIT_POST_ID = '00000000-0000-7000-8000-00000000000b';

describe('UserDeletion (e2e) — DELETE /users/me', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;
  // 관찰자 — 탈퇴자와 상호작용하고 살아남아 "남는 것"을 검증한다.
  let observerToken: string;
  let observerId: string;

  beforeAll(async () => {
    ({ app, container, db, pool } = await setupE2E());
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await container.stop();
  });

  // fakeVerifier가 accessToken을 providerUserId로 에코한다(다른 스펙과 동일).
  const signup = async (accessToken: string, nickname: string) => {
    const res = await request(server)
      .post('/auth/signup')
      .send({ provider: 'kakao', platform: 'ios', accessToken, nickname });
    expect(res.status).toBe(201);
    return (res.body as { accessToken: string }).accessToken;
  };

  const idOf = async (nickname: string) => {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.nickname, nickname));
    return row.id;
  };

  // 탈퇴 대상 — 매 테스트 새로 만든다.
  let quitterToken: string;
  let quitterId: string;

  beforeEach(async () => {
    await db.delete(posts);
    await db.delete(plants);
    await db.delete(users);

    observerToken = await signup('deletion-observer', '관찰자');
    observerId = await idOf('관찰자');
    quitterToken = await signup('deletion-quitter', '탈퇴자');
    quitterId = await idOf('탈퇴자');
  });

  const withdraw = async (token: string | null = quitterToken) => {
    let req = request(server).delete('/users/me');
    if (token !== null) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  const insertPost = (id: string, authorId: string) =>
    db.insert(posts).values({
      id,
      authorId,
      title: '제목',
      content: '<p>본문</p>',
      excerpt: '본문',
      imageKeys: [],
    });

  describe('백본', () => {
    it('204: 계정이 사라진다', async () => {
      const { status } = await withdraw();
      expect(status).toBe(204);

      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, quitterId));
      expect(rows).toHaveLength(0);
    });

    it('401: 무인증', async () => {
      const { status } = await withdraw(null);
      expect(status).toBe(401);
      expect(await db.select().from(users)).toHaveLength(2);
    });

    it('404: 이미 탈퇴한 계정의 잔존 토큰으로 재요청 → USER_NOT_FOUND', async () => {
      await withdraw();

      const { status, body } = await withdraw();
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_NOT_FOUND');
    });
  });

  describe('함께 사라지는 것 (개인 활동 — cascade)', () => {
    it('세션 전부', async () => {
      await withdraw();
      const rows = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, quitterId));
      expect(rows).toHaveLength(0);
    });

    it('내 식물 + 물주기 기록(2단 cascade)', async () => {
      const [plant] = await db
        .insert(userPlants)
        .values({ ownerId: quitterId, name: '초록이', images: [] })
        .returning({ id: userPlants.id });
      await db
        .insert(waterings)
        .values({ userPlantId: plant.id, wateredOn: '2026-07-01' });

      await withdraw();

      expect(await db.select().from(userPlants)).toHaveLength(0);
      // waterings는 users를 직접 참조하지 않는다 — user_plants를 거친 2단 전파다.
      expect(await db.select().from(waterings)).toHaveLength(0);
    });

    it('차단 — 내가 건 것과 남이 나를 차단한 것 **양방향**', async () => {
      await db
        .insert(userBlocks)
        .values({ blockerId: quitterId, blockedId: observerId });
      await db
        .insert(userBlocks)
        .values({ blockerId: observerId, blockedId: quitterId });

      await withdraw();
      expect(await db.select().from(userBlocks)).toHaveLength(0);
    });

    // 글 삭제 = 스레드 전체 소멸이라는 게시판 관례를 탈퇴에 일괄 적용한 것 —
    // 유저가 자기 글을 하나씩 지우고 탈퇴한 것과 결과가 같아야 한다(post.table.ts).
    it('작성한 글 — 그 글에 달린 **타인의 댓글·좋아요까지** 함께 사라진다', async () => {
      await insertPost(QUIT_POST_ID, quitterId);
      // 관찰자(제3자)가 탈퇴자의 글에 댓글 + 좋아요를 남긴다.
      await request(server)
        .post(`/posts/${QUIT_POST_ID}/comments`)
        .set('Authorization', `Bearer ${observerToken}`)
        .send({ content: '남의 댓글' })
        .expect(201);
      await request(server)
        .put(`/posts/${QUIT_POST_ID}/like`)
        .set('Authorization', `Bearer ${observerToken}`)
        .expect(200);

      await withdraw();

      expect(
        await db.select().from(posts).where(eq(posts.id, QUIT_POST_ID)),
      ).toHaveLength(0);
      // posts cascade가 루트+답글을 한 문장에 지우므로 fk_comments_parent(NO ACTION)를
      // 통과한다 — comment.table.ts 유예 ①이 되살아나지 않는 근거.
      expect(await db.select().from(comments)).toHaveLength(0);
      expect(await db.select().from(postLikes)).toHaveLength(0);
    });
  });

  describe('남는 것 (남의 글에 단 댓글 — set null)', () => {
    it('댓글이 남고 commentCount는 그대로다 (유예 ② 해소의 회귀 방어)', async () => {
      await insertPost(OTHER_POST_ID, observerId);
      // 카운터를 쓰기 경로로 올려둔다 — 탈퇴가 이 값을 건드리면 안 된다.
      await request(server)
        .post(`/posts/${OTHER_POST_ID}/comments`)
        .set('Authorization', `Bearer ${quitterToken}`)
        .send({ content: '탈퇴자의 루트 댓글' })
        .expect(201);

      const before = await db
        .select({ commentCount: posts.commentCount })
        .from(posts)
        .where(eq(posts.id, OTHER_POST_ID));
      expect(before[0].commentCount).toBe(1);

      await withdraw();

      const rows = await db
        .select({ id: comments.id, authorId: comments.authorId })
        .from(comments);
      expect(rows).toHaveLength(1);
      expect(rows[0].authorId).toBeNull();

      const after = await db
        .select({ commentCount: posts.commentCount })
        .from(posts)
        .where(eq(posts.id, OTHER_POST_ID));
      // 댓글 행이 안 지워지므로 드리프트할 수 없다. comments.authorId를 cascade로
      // 되돌리면 행은 사라지는데 카운터는 1로 남아 여기가 터진다.
      expect(after[0].commentCount).toBe(1);
    });

    it('카탈로그 식물은 남고 createdById만 NULL이 된다 (공유 자산)', async () => {
      const [plant] = await db
        .insert(plants)
        .values({
          name: '몬스테라 알보',
          images: [{ key: 'plant-image/a.jpg' }],
          createdById: quitterId,
        })
        .returning({ id: plants.id });

      await withdraw();

      const [row] = await db
        .select({ createdById: plants.createdById })
        .from(plants)
        .where(eq(plants.id, plant.id));
      expect(row).toBeDefined();
      expect(row.createdById).toBeNull();
    });
  });

  /**
   * 이 describe가 `DeleteUserUseCase`의 존재 이유를 지킨다. 오케스트레이션이 통째로
   * 사라져도(= users만 지우고 cascade에 맡겨도) API는 204를 반환하고 post_likes 행도
   * 사라진다 — **틀리는 건 카운터뿐**이다. 그래서 아래 단언이 유일한 신호다.
   */
  describe('likeCount 정확성', () => {
    it('탈퇴자가 **남의 글**에 누른 좋아요만큼 카운터가 내려간다', async () => {
      // 두 글 모두 관찰자 소유 — 탈퇴자 자기 글이면 글째로 사라져 카운터 검증이 무의미하다
      // (드리프트가 실제로 문제되는 건 남의 글뿐이다 — post-like.table.ts).
      await insertPost(OTHER_POST_ID, observerId);
      await insertPost(QUIT_POST_ID, observerId);

      const like = (postId: string, token: string) =>
        request(server)
          .put(`/posts/${postId}/like`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

      // 글 2개에 탈퇴자 + 관찰자가 각각 좋아요 → 둘 다 likeCount 2.
      await like(OTHER_POST_ID, quitterToken);
      await like(OTHER_POST_ID, observerToken);
      await like(QUIT_POST_ID, quitterToken);
      await like(QUIT_POST_ID, observerToken);

      await withdraw();

      const rows = await db
        .select({ id: posts.id, likeCount: posts.likeCount })
        .from(posts);
      for (const row of rows) {
        expect(row.likeCount).toBe(1);
      }

      // 행 자체도 탈퇴자 것만 사라진다.
      const likes = await db.select().from(postLikes);
      expect(likes).toHaveLength(2);
      expect(likes.every((l) => l.userId === observerId)).toBe(true);
    });

    it('좋아요 0개인 유저의 탈퇴도 204 (빈 배열 가드)', async () => {
      // adjustLikeCounts가 빈 배열을 거르지 않으면 inArray가 여기서 터진다.
      const { status } = await withdraw();
      expect(status).toBe(204);
    });
  });

  describe('잔존 access token — 무상태 검증이라 만료까지 살아있다', () => {
    // ⚠️ `beforeEach(withdraw)`로 쓰면 안 된다 — vitest가 훅에 테스트 컨텍스트를 넘겨
    //    그게 token 인자로 들어간다(헤더에 객체가 실려 터진다).
    beforeEach(() => withdraw());

    it('글 작성 → 401 (FK_POSTS_AUTHOR 23503 변환)', async () => {
      await request(server)
        .post('/posts')
        .set('Authorization', `Bearer ${quitterToken}`)
        .send({ title: '제목', content: '<p>본문</p>' })
        .expect(401);
    });

    it('좋아요 → 401 (FK_POST_LIKES_USER 23503 변환)', async () => {
      await insertPost(OTHER_POST_ID, observerId);
      await request(server)
        .put(`/posts/${OTHER_POST_ID}/like`)
        .set('Authorization', `Bearer ${quitterToken}`)
        .expect(401);
    });

    it('GET /users/me → 404 USER_NOT_FOUND (401이 아니다 — web 갱신 인터셉터가 못 잡는다)', async () => {
      const res = await request(server)
        .get('/users/me')
        .set('Authorization', `Bearer ${quitterToken}`);
      expect(res.status).toBe(404);
      expect((res.body as Record<string, unknown>).errorCode).toBe(
        'USER_NOT_FOUND',
      );
    });

    it('공개 읽기는 200 — isLiked는 false로 떨어진다', async () => {
      await insertPost(OTHER_POST_ID, observerId);
      const res = await request(server)
        .get('/posts')
        .set('Authorization', `Bearer ${quitterToken}`);
      expect(res.status).toBe(200);
      const body = res.body as { posts: Array<{ isLiked: boolean }> };
      expect(body.posts.every((p) => !p.isLiked)).toBe(true);
    });
  });
});
