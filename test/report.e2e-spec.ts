import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { comments, posts, reports, users } from '../src/database/schema';
import { setupE2E } from './helpers/setup-e2e';

const POST_ID = '00000000-0000-7000-8000-00000000000b'; // 보브 작성
const ROOT_ID = '00000000-0000-7000-8000-0000000000b1'; // 보브 루트 댓글
const DELETED_ROOT_ID = '00000000-0000-7000-8000-0000000000b3'; // soft-deleted 루트
const DELETED_REPLY_ID = '00000000-0000-7000-8000-0000000000b4'; // 그 루트의 답글(스레드 보존)
const ABSENT_ID = '00000000-0000-7000-8000-999999999999';

describe('Report (e2e) — POST /reports (접수만, 심사 주체 없음)', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;
  let aliceToken: string;
  let aliceId: string;
  let bobId: string;

  // describe 스코프 — 탈퇴 전파 테스트가 자기 전용 유저를 만들어 쓴다(다른 테스트의
  // 토큰을 죽이면 파일 내 실행 순서에 의존하게 된다).
  const signup = async (accessToken: string, nickname: string) => {
    const res = await request(server)
      .post('/auth/signup')
      .send({ provider: 'kakao', platform: 'ios', accessToken, nickname });
    return (res.body as { accessToken: string }).accessToken;
  };

  beforeAll(async () => {
    ({ app, container, db, pool } = await setupE2E());
    server = app.getHttpServer() as Server;

    aliceToken = await signup('report-alice', '앨리스');
    await signup('report-bob', '보브');

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
    await db.delete(reports);
    await db.delete(posts); // comments cascade

    await db.insert(posts).values({
      id: POST_ID,
      authorId: bobId,
      title: '제목',
      content: '<p>본문</p>',
      excerpt: '본문',
      imageKeys: [],
    });
    await db.insert(comments).values([
      { id: ROOT_ID, postId: POST_ID, authorId: bobId, content: '보브 댓글' },
      // soft-deleted 루트(플레이스홀더) — content NULL ⇔ deletedAt NOT NULL 불변식.
      {
        id: DELETED_ROOT_ID,
        postId: POST_ID,
        authorId: bobId,
        content: null,
        deletedAt: new Date(),
      },
    ]);
    await db.insert(comments).values({
      id: DELETED_REPLY_ID,
      postId: POST_ID,
      parentId: DELETED_ROOT_ID,
      authorId: bobId,
      content: '답글',
    });
  });

  // token: null = 무인증 요청.
  const report = async (
    body: Record<string, unknown>,
    token: string | null = aliceToken,
  ) => {
    let req = request(server).post('/reports');
    if (token !== null) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req.send(body);
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  const selectReports = () => db.select().from(reports);

  describe('접수 성공', () => {
    it('201: 게시글 신고 — targetAuthorId가 서버에서 채워진다', async () => {
      const { status, body } = await report({
        targetType: 'post',
        targetId: POST_ID,
        reason: 'spam',
      });
      expect(status).toBe(201);
      expect(body.id).toEqual(expect.any(String));
      expect(body.createdAt).toEqual(expect.any(String));

      const rows = await selectReports();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        reporterId: aliceId,
        targetType: 'post',
        targetId: POST_ID,
        // 소급 불가한 컬럼 — 대상이 삭제된 뒤엔 어떤 방법으로도 복원할 수 없다.
        targetAuthorId: bobId,
        reason: 'spam',
        detail: null,
      });
    });

    it('201: 댓글 신고 — targetAuthorId = 댓글 작성자', async () => {
      const { status } = await report({
        targetType: 'comment',
        targetId: ROOT_ID,
        reason: 'abuse',
        detail: '욕설이 포함되어 있습니다',
      });
      expect(status).toBe(201);

      const [row] = await selectReports();
      expect(row).toMatchObject({
        targetType: 'comment',
        targetId: ROOT_ID,
        targetAuthorId: bobId,
        reason: 'abuse',
        detail: '욕설이 포함되어 있습니다',
      });
    });

    it('201: 유저 신고 — targetId === targetAuthorId (정의상 동일)', async () => {
      const { status } = await report({
        targetType: 'user',
        targetId: bobId,
        reason: 'illegal',
        detail: '멸종위기종 거래를 시도합니다',
      });
      expect(status).toBe(201);

      const [row] = await selectReports();
      expect(row.targetId).toBe(bobId);
      expect(row.targetAuthorId).toBe(bobId);
    });

    // 차단(SelfBlockError)과 의도적으로 갈린다 — 자기 신고는 무해하고 admin이 기각하면 끝.
    it('201: 자기 콘텐츠 신고를 막지 않는다', async () => {
      const { status } = await report({
        targetType: 'user',
        targetId: aliceId,
        reason: 'other',
        detail: '테스트',
      });
      expect(status).toBe(201);
    });

    it('201: 다른 대상이면 같은 사유로 여러 건 접수 가능', async () => {
      await report({ targetType: 'post', targetId: POST_ID, reason: 'spam' });
      const { status } = await report({
        targetType: 'comment',
        targetId: ROOT_ID,
        reason: 'spam',
      });
      expect(status).toBe(201);
      expect(await selectReports()).toHaveLength(2);
    });
  });

  describe('중복 — 409 (멱등 성공으로 삼키지 않는다)', () => {
    it('409 REPORT_ALREADY_EXISTS: 같은 대상 재신고', async () => {
      await report({ targetType: 'post', targetId: POST_ID, reason: 'spam' });
      const { status, body } = await report({
        targetType: 'post',
        targetId: POST_ID,
        reason: 'abuse', // 사유가 달라도 대상이 같으면 중복이다
      });
      expect(status).toBe(409);
      expect(body.errorCode).toBe('REPORT_ALREADY_EXISTS');
      expect(await selectReports()).toHaveLength(1);
    });
  });

  describe('대상 부재 — 404', () => {
    it('404 REPORT_TARGET_NOT_FOUND: 없는 게시글', async () => {
      const { status, body } = await report({
        targetType: 'post',
        targetId: ABSENT_ID,
        reason: 'spam',
      });
      expect(status).toBe(404);
      expect(body.errorCode).toBe('REPORT_TARGET_NOT_FOUND');
      expect(await selectReports()).toHaveLength(0);
    });

    it('404: 없는 유저', async () => {
      const { status } = await report({
        targetType: 'user',
        targetId: ABSENT_ID,
        reason: 'abuse',
      });
      expect(status).toBe(404);
    });

    // 본문이 NULL로 지워져 있어 심사할 것이 없다 — 플레이스홀더는 신고 대상이 아니다.
    it('404: soft-deleted 댓글(플레이스홀더)', async () => {
      const { status, body } = await report({
        targetType: 'comment',
        targetId: DELETED_ROOT_ID,
        reason: 'abuse',
      });
      expect(status).toBe(404);
      expect(body.errorCode).toBe('REPORT_TARGET_NOT_FOUND');
    });

    it('404: 타입이 어긋난 id (댓글 id를 post로 신고)', async () => {
      const { status } = await report({
        targetType: 'post',
        targetId: ROOT_ID,
        reason: 'spam',
      });
      expect(status).toBe(404);
    });
  });

  describe('검증 · 인증', () => {
    it('400: 알 수 없는 targetType', async () => {
      const { status } = await report({
        targetType: 'plant',
        targetId: POST_ID,
        reason: 'spam',
      });
      expect(status).toBe(400);
    });

    it('400: 알 수 없는 reason', async () => {
      const { status } = await report({
        targetType: 'post',
        targetId: POST_ID,
        reason: 'because',
      });
      expect(status).toBe(400);
    });

    it('400: detail 길이 초과 (최소수집 상한)', async () => {
      const { status } = await report({
        targetType: 'post',
        targetId: POST_ID,
        reason: 'other',
        detail: 'ㄱ'.repeat(1001),
      });
      expect(status).toBe(400);
    });

    it('401: 무인증', async () => {
      const { status } = await report(
        { targetType: 'post', targetId: POST_ID, reason: 'spam' },
        null,
      );
      expect(status).toBe(401);
      expect(await selectReports()).toHaveLength(0);
    });
  });

  describe('이력 수명 — 신고는 대상보다 오래 산다', () => {
    // report.table.ts의 핵심 결정: FK를 걸지 않은 이유가 이것이다. cascade였다면
    // 신고당한 글을 지우는 것이 이력 세탁이 된다.
    it('대상 글이 삭제돼도 신고 행은 남는다 (targetAuthorId 포함)', async () => {
      await report({ targetType: 'post', targetId: POST_ID, reason: 'spam' });
      await db.delete(posts).where(eq(posts.id, POST_ID));

      const rows = await selectReports();
      expect(rows).toHaveLength(1);
      expect(rows[0].targetId).toBe(POST_ID); // dangling — admin이 "삭제된 대상"으로 표시
      expect(rows[0].targetAuthorId).toBe(bobId);
    });

    it('신고자가 탈퇴하면 reporterId만 NULL이 되고 건은 남는다', async () => {
      // 전용 유저 — alice를 지우면 다른 테스트의 토큰이 죽어 실행 순서에 의존하게 된다.
      const quitterToken = await signup('report-quitter', '탈퇴자');
      const { status } = await report(
        { targetType: 'post', targetId: POST_ID, reason: 'spam' },
        quitterToken,
      );
      expect(status).toBe(201);

      await db.delete(users).where(eq(users.nickname, '탈퇴자'));

      const rows = await selectReports();
      expect(rows).toHaveLength(1);
      expect(rows[0].reporterId).toBeNull();
      expect(rows[0].targetAuthorId).toBe(bobId);
    });
  });
});
