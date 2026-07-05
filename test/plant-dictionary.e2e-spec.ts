import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { genera, species } from '../src/database/schema';
import { setupE2E } from './helpers/setup-e2e';

describe('PlantDictionary (e2e)', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;

  beforeAll(async () => {
    ({ app, container, db, pool } = await setupE2E());
    server = app.getHttpServer() as Server;

    // 공개 라우트라 인증 셋업 불필요. FK 순서: genera 먼저, species 나중.
    // 정렬 검증을 위해 비가나다순으로 삽입한다.
    await db
      .insert(genera)
      .values([{ name: '필로덴드론' }, { name: '몬스테라' }, { name: '안스리움' }]);
    await db.insert(species).values([
      { genus: '몬스테라', name: '아단소니' },
      { genus: '몬스테라', name: '델리시오사' },
      { genus: '필로덴드론', name: '글로리오섬' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await container.stop();
  });

  it('200: GET /genera — 전체 속 가나다순 + Cache-Control', async () => {
    const res = await request(server).get('/genera');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ genera: ['몬스테라', '안스리움', '필로덴드론'] });
    expect(res.headers['cache-control']).toBe(
      'public, max-age=3600, stale-while-revalidate=86400',
    );
  });

  it('200: GET /species?genus= — 해당 속의 종만 가나다순 + Cache-Control', async () => {
    const res = await request(server)
      .get('/species')
      .query({ genus: '몬스테라' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ species: ['델리시오사', '아단소니'] });
    expect(res.headers['cache-control']).toBe(
      'public, max-age=3600, stale-while-revalidate=86400',
    );
  });

  it('200: 미등록 속 — 빈 배열 (필터이지 조회 실패가 아님)', async () => {
    const res = await request(server)
      .get('/species')
      .query({ genus: '고무나무' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ species: [] });
  });

  it('400: genus 누락 (Zod)', async () => {
    const res = await request(server).get('/species');
    expect(res.status).toBe(400);
  });

  it('400: genus 공백뿐 (Zod)', async () => {
    const res = await request(server).get('/species').query({ genus: '   ' });
    expect(res.status).toBe(400);
  });
});
