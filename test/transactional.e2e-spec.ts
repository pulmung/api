import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { TransactionHost, Transactional } from '@nestjs-cls/transactional';
import type { DrizzleDB } from '../src/database/drizzle.constants';
import type { DrizzleTransactionalAdapter } from '../src/database/drizzle-transactional.adapter';
import { postLikes, posts, users } from '../src/database/schema';
import { setupE2E } from './helpers/setup-e2e';

const POST_ID = '00000000-0000-7000-8000-000000000001';

/**
 * 트랜잭션 배선 전용 fixture — 실제 엔드포인트로는 이 계약을 검증할 수 없다.
 * `@Transactional()`이 아무 일도 안 하더라도(= CLS 컨텍스트 부재로 조용히 무효화)
 * 좋아요·댓글 API는 여전히 "성공"한다. 각 쓰기가 따로 커밋될 뿐 최종 상태가 같기 때문이다.
 * 그 침묵이 이 방식의 대표 실패 모드라, **중간에 실패시키고 롤백을 확인**하는 경로를 둔다.
 */
@Controller('__tx__')
class TransactionProbeController {
  constructor(
    private readonly txHost: TransactionHost<DrizzleTransactionalAdapter>,
  ) {}

  // 프로덕션 어댑터들이 쓰는 것과 정확히 같은 핸들(txHost.tx)로 쓴 뒤 던진다.
  @Post('rollback')
  @Transactional()
  async rollback(@Body() body: { userId: string }): Promise<never> {
    await this.txHost.tx
      .insert(postLikes)
      .values({ postId: POST_ID, userId: body.userId });
    throw new Error('boom — 이 예외가 트랜잭션을 되돌려야 한다');
  }

  @Post('commit')
  @Transactional()
  async commit(@Body() body: { userId: string }): Promise<{ ok: true }> {
    await this.txHost.tx
      .insert(postLikes)
      .values({ postId: POST_ID, userId: body.userId });
    return { ok: true };
  }

  // 트랜잭션 밖 — 어댑터가 fallback 인스턴스(평범한 db)로 정상 동작하는지.
  @Post('no-transaction')
  async noTransaction(@Body() body: { userId: string }): Promise<{ ok: true }> {
    await this.txHost.tx
      .insert(postLikes)
      .values({ postId: POST_ID, userId: body.userId });
    return { ok: true };
  }
}

describe('Transactional 배선 (e2e) — CLS 트랜잭션이 실제로 살아있는가', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;
  let userId: string;

  beforeAll(async () => {
    ({ app, container, db, pool } = await setupE2E([
      TransactionProbeController,
    ]));
    server = app.getHttpServer() as Server;

    await request(server).post('/auth/signup').send({
      provider: 'kakao',
      platform: 'ios',
      accessToken: 'tx-probe-user',
      nickname: '트랜잭션',
    });
    const [row] = await db.select({ id: users.id }).from(users);
    userId = row.id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    await db.delete(posts);
    await db.insert(posts).values({
      id: POST_ID,
      authorId: userId,
      title: '제목',
      content: '<p>본문</p>',
      excerpt: '본문',
      imageKeys: [],
    });
  });

  const selectLikes = () => db.select().from(postLikes);

  it('@Transactional 메서드가 던지면 그 안의 쓰기가 전부 롤백된다', async () => {
    const res = await request(server).post('/__tx__/rollback').send({ userId });
    expect(res.status).toBe(500);

    // 여기가 핵심: 배선이 죽어 있으면 이 행이 남아있다(autocommit).
    expect(await selectLikes()).toEqual([]);
  });

  it('정상 종료하면 커밋된다 (롤백 테스트가 "항상 실패"로 통과하는 것을 배제)', async () => {
    const res = await request(server).post('/__tx__/commit').send({ userId });
    expect(res.status).toBe(201);
    expect(await selectLikes()).toHaveLength(1);
  });

  it('트랜잭션 밖에서도 같은 핸들로 쓰기가 동작한다 (fallback 인스턴스)', async () => {
    const res = await request(server)
      .post('/__tx__/no-transaction')
      .send({ userId });
    expect(res.status).toBe(201);
    expect(await selectLikes()).toHaveLength(1);
  });

  it('글 삭제 cascade가 롤백된 좋아요와 무관하게 동작한다 (상태 오염 없음)', async () => {
    await request(server).post('/__tx__/rollback').send({ userId });
    await request(server).post('/__tx__/commit').send({ userId });

    await db.delete(posts).where(eq(posts.id, POST_ID));
    expect(await selectLikes()).toEqual([]);
  });
});
