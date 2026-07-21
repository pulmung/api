import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { plants, posts, users } from '../src/database/schema';
import { setupE2E, FakeFileStorage } from './helpers/setup-e2e';
import { TEST_FILE_BASE_URL } from './helpers/test-env';
import { uuidv7 } from 'uuidv7';

const IMG_KEY = 'post-image/0198c5b2-2f74-7abc-8def-000000000001.jpg';
const imgSrc = (key: string) => `${TEST_FILE_BASE_URL}/${key}`;

describe('Post 작성 (e2e)', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;
  let fakeStorage: FakeFileStorage;
  let authorToken: string;
  let authorId: string;

  beforeAll(async () => {
    ({ app, container, db, pool, fakeStorage } = await setupE2E());
    server = app.getHttpServer() as Server;

    const res = await request(server).post('/auth/signup').send({
      provider: 'kakao',
      platform: 'ios',
      accessToken: 'post-create-author',
      nickname: '글쓴이',
    });
    authorToken = (res.body as { accessToken: string }).accessToken;
    const rows = await db.select({ id: users.id }).from(users);
    authorId = rows[0].id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    // users는 지우지 않는다 — beforeAll에서 가입한 토큰 유저가 살아있어야 authorId FK가 성립.
    await db.delete(posts);
    await db.delete(plants);
    fakeStorage.missingKeys.clear();
  });

  // token: null = 무인증 요청 (undefined를 넘기면 JS 기본값이 적용돼 인증돼버린다 — null 센티널).
  const createPost = async (
    body: Record<string, unknown>,
    token: string | null = authorToken,
  ) => {
    let req = request(server).post('/posts');
    if (token !== null) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req.send(body);
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  it('201: 오염된 HTML이 정화돼 저장되고, 응답 = 조회 표현 + 파생 컬럼 확인', async () => {
    const [catalog] = await db
      .insert(plants)
      .values({ name: '몬스테라 알보', images: [{ key: 'plant-image/c.jpg' }] })
      .returning({ id: plants.id });

    const { status, body } = await createPost({
      title: '  잎이 갈변해요  ',
      content:
        `<p>우리집 <b>몬스테라</b> 잎이 <span class="color-red evil">갈색</span>이에요` +
        `<script>alert(1)</script></p>` +
        `<img src="${imgSrc(IMG_KEY)}" onerror="alert(1)" />` +
        `<h1>혹시 과습인가요?</h1>`,
      plantId: catalog.id,
    });

    expect(status).toBe(201);
    // 정화: b→strong 정규화, script 통째 드랍, 팔레트 외 class 제거, onerror 제거, h1 태그만 벗김.
    const content = body.content as string;
    expect(content).toContain('<strong>몬스테라</strong>');
    expect(content).toContain('<span class="color-red">갈색</span>');
    expect(content).toContain(`<img src="${imgSrc(IMG_KEY)}" />`);
    expect(content).toContain('혹시 과습인가요?');
    expect(content).not.toContain('script');
    expect(content).not.toContain('evil');
    expect(content).not.toContain('onerror');
    expect(content).not.toContain('<h1>');
    // 조회 표현: title trim·작성자·태그·썸네일·발췌.
    expect(body.title).toBe('잎이 갈변해요');
    expect(body.author).toEqual({ id: authorId, nickname: '글쓴이' });
    expect(body.plant).toEqual({ id: catalog.id, name: '몬스테라 알보' });
    expect(body.thumbnailUrl).toBe(imgSrc(IMG_KEY));
    expect(body.excerpt).toBe(
      '우리집 몬스테라 잎이 갈색이에요 혹시 과습인가요?',
    );
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // 파생 컬럼이 저장본과 함께 영속화됐는지 DB 직접 확인.
    const [row] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, body.id as string));
    expect(row.excerpt).toBe('우리집 몬스테라 잎이 갈색이에요 혹시 과습인가요?');
    expect(row.thumbnailKey).toBe(IMG_KEY);
    expect(row.imageKeys).toEqual([IMG_KEY]);
  });

  it('201: 태그·이미지 없는 평문 글 — plant/thumbnailUrl null', async () => {
    const { status, body } = await createPost({
      title: '흙 추천해주세요',
      content: '배수 잘 되는 흙 뭐 쓰세요?',
    });
    expect(status).toBe(201);
    expect(body.plant).toBeNull();
    expect(body.thumbnailUrl).toBeNull();
    expect(body.content).toBe('배수 잘 되는 흙 뭐 쓰세요?');
    expect(body.excerpt).toBe('배수 잘 되는 흙 뭐 쓰세요?');
  });

  it('401: 토큰 없음', async () => {
    const { status, body } = await createPost(
      { title: '제목', content: '<p>본문</p>' },
      null,
    );
    expect(status).toBe(401);
    expect(body.errorCode).toBe('UNAUTHENTICATED');
  });

  it.each([
    ['title 없음', { content: '<p>본문</p>' }],
    ['title 공백뿐 (trim 후 0자)', { title: '   ', content: '<p>본문</p>' }],
    ['content 없음', { title: '제목' }],
    ['content 빈 문자열', { title: '제목', content: '' }],
    ['plantId 비uuid', { title: '제목', content: '<p>본문</p>', plantId: 'x' }],
  ])('400: %s (Zod)', async (_, body) => {
    const { status } = await createPost(body);
    expect(status).toBe(400);
  });

  it('422: 비존재 plantId → REFERENCED_PLANT_NOT_FOUND (FK 23503 변환)', async () => {
    const { status, body } = await createPost({
      title: '제목',
      content: '<p>본문</p>',
      plantId: uuidv7(),
    });
    expect(status).toBe(422);
    expect(body.errorCode).toBe('REFERENCED_PLANT_NOT_FOUND');
  });

  it('422: 업로드 안 된 이미지 key → POST_IMAGE_NOT_UPLOADED (head 검증)', async () => {
    fakeStorage.missingKeys.add(IMG_KEY);
    const { status, body } = await createPost({
      title: '제목',
      content: `<p>a</p><img src="${imgSrc(IMG_KEY)}" />`,
    });
    expect(status).toBe(422);
    expect(body.errorCode).toBe('POST_IMAGE_NOT_UPLOADED');
  });

  it.each([
    ['외부 도메인', 'https://evil.example/post-image/x.jpg'],
    ['우리 CDN의 다른 purpose', `${TEST_FILE_BASE_URL}/plant-image/x.jpg`],
  ])('422: img src %s → INVALID_POST_IMAGE_SRC', async (_, src) => {
    const { status, body } = await createPost({
      title: '제목',
      content: `<p>a</p><img src="${src}" />`,
    });
    expect(status).toBe(422);
    expect(body.errorCode).toBe('INVALID_POST_IMAGE_SRC');
  });

  it('422: 알맹이 없는 본문(공백·빈 서식뿐) → INVALID_POST_CONTENT', async () => {
    const { status, body } = await createPost({
      title: '제목',
      content: '<p>   </p><p><br /></p>',
    });
    expect(status).toBe(422);
    expect(body.errorCode).toBe('INVALID_POST_CONTENT');
  });
});
