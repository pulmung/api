import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { sessions, users } from '../src/database/schema';
import { FakeFileStorage, setupE2E } from './helpers/setup-e2e';
import { TEST_FILE_BASE_URL } from './helpers/test-env';

// 아바타 key — POST /files(purpose: user-profile-image)가 발급하는 형태.
const AVATAR_KEY =
  'user-profile-image/0198c5b2-2f74-7abc-8def-0123456789ab.jpg';
const AVATAR_URL = `${TEST_FILE_BASE_URL}/${AVATAR_KEY}`;

describe('UserProfile (e2e)', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let db: DrizzleDB;
  let server: Server;
  let pool: Pool;
  let fakeStorage: FakeFileStorage;
  let meToken: string;
  let meId: string;

  beforeAll(async () => {
    ({ app, container, db, pool, fakeStorage } = await setupE2E());
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await container.stop();
  });

  // 가입 = 유저 생성 + access token 확보. fakeVerifier가 accessToken을 providerUserId로 에코.
  const signup = async (accessToken: string, nickname: string) => {
    const res = await request(server)
      .post('/auth/signup')
      .send({ provider: 'kakao', platform: 'ios', accessToken, nickname });
    return (res.body as { accessToken: string }).accessToken;
  };

  // 닉네임이 전역 유니크 + PATCH가 그걸 변조하므로 매 테스트 유저를 리셋하고 새로 가입한다
  // (user-plant E2E처럼 beforeAll 가입을 유지하면 테스트 간 닉네임 상태가 샌다).
  beforeEach(async () => {
    // head 기본값 = "존재" — 미업로드 시뮬레이션한 테스트가 다음으로 새지 않게 리셋.
    fakeStorage.missingKeys.clear();
    await db.delete(sessions);
    await db.delete(users);
    meToken = await signup('user-profile-me', '프로필유저');
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.nickname, '프로필유저'));
    meId = row.id;
  });

  const getMe = async (token?: string) => {
    let req = request(server).get('/users/me');
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  const patchMe = async (payload: object, token?: string) => {
    let req = request(server).patch('/users/me');
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    const res = await req.send(payload);
    return { status: res.status, body: res.body as Record<string, unknown> };
  };

  // GET/PATCH가 공유하는 조회 표현의 기대값 — email은 fakeVerifier 고정값.
  const meProfile = () => ({
    id: meId,
    provider: 'kakao',
    email: 'test@example.com',
    nickname: '프로필유저',
    // 가입 직후엔 아바타가 없다 — 기본 이미지는 서버가 주지 않는다(클라 소유).
    profileImageUrl: null,
    createdAt: expect.stringMatching(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    ) as unknown,
  });

  describe('GET /users/me', () => {
    it('200: 내 프로필 조회 — 정확한 바디 매칭(providerUserId 미누출 증명)', async () => {
      const { status, body } = await getMe(meToken);
      expect(status).toBe(200);
      expect(body).toEqual(meProfile());
    });

    it('401: 토큰 없음', async () => {
      const { status, body } = await getMe();
      expect(status).toBe(401);
      expect(body.errorCode).toBe('UNAUTHENTICATED');
    });

    it('404: 행이 사라진 유저의 여전히 유효한(무상태) 토큰', async () => {
      await db.delete(sessions);
      await db.delete(users);
      const { status, body } = await getMe(meToken);
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_NOT_FOUND');
    });
  });

  describe('PATCH /users/me', () => {
    it('200: 닉네임 수정 — trim 반영, 응답 = GET 표현, DB 반영', async () => {
      const { status, body } = await patchMe(
        { nickname: '  새닉네임  ' },
        meToken,
      );
      expect(status).toBe(200);
      expect(body).toEqual({ ...meProfile(), nickname: '새닉네임' });

      const [row] = await db
        .select({ nickname: users.nickname })
        .from(users)
        .where(eq(users.id, meId));
      expect(row.nickname).toBe('새닉네임');
    });

    it('200: 현재 닉네임 그대로 no-op — 같은 행이라 유니크 충돌 아님', async () => {
      const { status, body } = await patchMe(
        { nickname: '프로필유저' },
        meToken,
      );
      expect(status).toBe(200);
      expect(body).toEqual(meProfile());
    });

    it.each([
      ['빈 패치 (no-op = 클라 버그)', {}],
      ['1자 (최소 미만)', { nickname: 'a' }],
      ['21자 (최대 초과)', { nickname: 'a'.repeat(21) }],
      ['null (notnull 필드라 해제 불가)', { nickname: null }],
    ])('400: %s', async (_, payload) => {
      const { status } = await patchMe(payload, meToken);
      expect(status).toBe(400);
    });

    it('401: 토큰 없음', async () => {
      const { status, body } = await patchMe({ nickname: '새닉네임' });
      expect(status).toBe(401);
      expect(body.errorCode).toBe('UNAUTHENTICATED');
    });

    it('404: 행이 사라진 유저의 여전히 유효한(무상태) 토큰', async () => {
      await db.delete(sessions);
      await db.delete(users);
      const { status, body } = await patchMe({ nickname: '새닉네임' }, meToken);
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_NOT_FOUND');
    });

    it('409: 남이 쓰는 닉네임 — 내 닉네임은 그대로', async () => {
      await signup('user-profile-other', '이웃유저');

      const { status, body } = await patchMe({ nickname: '이웃유저' }, meToken);
      expect(status).toBe(409);
      expect(body.errorCode).toBe('NICKNAME_TAKEN');

      const [row] = await db
        .select({ nickname: users.nickname })
        .from(users)
        .where(eq(users.id, meId));
      expect(row.nickname).toBe('프로필유저');
    });
  });

  // 아바타는 merge-patch 3분기(부재/값/null)를 실제로 쓰는 첫 필드다 — nickname은 notnull이라
  // 해제가 없어 이 축이 검증된 적이 없었다.
  describe('PATCH /users/me — profileImageKey (merge-patch 3분기)', () => {
    const storedKey = async () => {
      const [row] = await db
        .select({ key: users.profileImageKey })
        .from(users)
        .where(eq(users.id, meId));
      return row.key;
    };

    it('200: 값 = 교체 — 응답은 URL, DB엔 불투명 key', async () => {
      const { status, body } = await patchMe(
        { profileImageKey: AVATAR_KEY },
        meToken,
      );
      expect(status).toBe(200);
      expect(body).toEqual({ ...meProfile(), profileImageUrl: AVATAR_URL });

      // 저장은 key만 — 전체 URL을 굽지 않는다(docs/file-upload.md §6).
      expect(await storedKey()).toBe(AVATAR_KEY);

      const { body: fetched } = await getMe(meToken);
      expect(fetched.profileImageUrl).toBe(AVATAR_URL);
    });

    it('200: 필드 부재 = 미변경 — 닉네임만 고쳐도 아바타가 살아있다', async () => {
      await patchMe({ profileImageKey: AVATAR_KEY }, meToken);

      const { status, body } = await patchMe({ nickname: '새닉네임' }, meToken);
      expect(status).toBe(200);
      expect(body.profileImageUrl).toBe(AVATAR_URL);
      expect(await storedKey()).toBe(AVATAR_KEY);
    });

    it('200: null = 해제 — 부재(미변경)와 갈리는 지점', async () => {
      await patchMe({ profileImageKey: AVATAR_KEY }, meToken);

      const { status, body } = await patchMe(
        { profileImageKey: null },
        meToken,
      );
      expect(status).toBe(200);
      expect(body.profileImageUrl).toBeNull();
      expect(await storedKey()).toBeNull();
    });

    it('422: 다른 purpose의 key — 정책 우회 차단(prefix 검증)', async () => {
      const { status, body } = await patchMe(
        {
          profileImageKey:
            'post-image/0198c5b2-2f74-7abc-8def-0123456789ab.jpg',
        },
        meToken,
      );
      expect(status).toBe(422);
      expect(body.errorCode).toBe('INVALID_PROFILE_IMAGE');
      expect(await storedKey()).toBeNull();
    });

    it('422: presign만 받고 업로드 안 한 key — 첨부 시점 head 검증', async () => {
      fakeStorage.missingKeys.add(AVATAR_KEY);

      const { status, body } = await patchMe(
        { profileImageKey: AVATAR_KEY },
        meToken,
      );
      expect(status).toBe(422);
      expect(body.errorCode).toBe('PROFILE_IMAGE_NOT_UPLOADED');
      expect(await storedKey()).toBeNull();
    });

    it('400: 빈 문자열 — 해제는 null이지 ""가 아니다', async () => {
      const { status } = await patchMe({ profileImageKey: '' }, meToken);
      expect(status).toBe(400);
    });
  });

  // 남의 프로필 — /users/me와 **다른 표현**이라는 것이 이 블록의 핵심 계약이다.
  describe('GET /users/:userId', () => {
    let otherToken: string;
    let otherId: string;

    const getUser = async (userId: string, token?: string) => {
      let req = request(server).get(`/users/${userId}`);
      if (token) req = req.set('Authorization', `Bearer ${token}`);
      const res = await req;
      return { status: res.status, body: res.body as Record<string, unknown> };
    };

    const setBlock = async (
      userId: string,
      token: string,
      blocked: boolean,
    ) => {
      const path = `/users/${userId}/block`;
      const req = blocked
        ? request(server).put(path)
        : request(server).delete(path);
      await req.set('Authorization', `Bearer ${token}`);
    };

    beforeEach(async () => {
      otherToken = await signup('user-profile-target', '옆집식집사');
      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.nickname, '옆집식집사'));
      otherId = row.id;
    });

    it('200(익명): 공개 필드만 — provider·email이 응답에 없다', async () => {
      const { status, body } = await getUser(otherId);
      expect(status).toBe(200);
      // toEqual = 정확 매칭이라 본인 전용 값이 새면 여기서 터진다.
      expect(body).toEqual({
        id: otherId,
        nickname: '옆집식집사',
        profileImageUrl: null,
        createdAt: expect.stringMatching(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
        ) as unknown,
        // 익명 뷰어에겐 차단 개념이 없다.
        isBlocked: false,
      });
    });

    it('200: 아바타 설정 시 읽기 URL — 저장은 key, 응답은 URL', async () => {
      await patchMe({ profileImageKey: AVATAR_KEY }, meToken);

      const { status, body } = await getUser(meId, otherToken);
      expect(status).toBe(200);
      expect(body.profileImageUrl).toBe(AVATAR_URL);
    });

    it('200: 내 id로 호출해도 공개 표현이다 — 본인 전용 값은 /users/me가 소유', async () => {
      const { status, body } = await getUser(meId, meToken);
      expect(status).toBe(200);
      expect(body.nickname).toBe('프로필유저');
      expect(body).not.toHaveProperty('email');
      expect(body).not.toHaveProperty('provider');
      // 자기 차단은 불가능하므로 항상 false (쿼리 없이 판정된다).
      expect(body.isBlocked).toBe(false);
    });

    it('200: isBlocked가 차단/해제를 따라간다 — 차단해도 프로필은 계속 200', async () => {
      expect((await getUser(otherId, meToken)).body.isBlocked).toBe(false);

      await setBlock(otherId, meToken, true);
      const blocked = await getUser(otherId, meToken);
      // 차단의 효과 범위는 "목록에서 숨김"이다 — 상세 접근은 그대로 200.
      expect(blocked.status).toBe(200);
      expect(blocked.body.isBlocked).toBe(true);

      await setBlock(otherId, meToken, false);
      expect((await getUser(otherId, meToken)).body.isBlocked).toBe(false);
    });

    it('200: 상대가 나를 차단해도 isBlocked는 false — 단방향(조용한 조치)', async () => {
      await setBlock(meId, otherToken, true);

      const { status, body } = await getUser(otherId, meToken);
      expect(status).toBe(200);
      // 여기서 true가 나오면 차단이 상대에게 드러난다 — 목록 필터(양방향)와 갈리는 지점.
      expect(body.isBlocked).toBe(false);
    });

    it('404: 없는 유저', async () => {
      const { status, body } = await getUser(
        '0198c5b2-2f74-7abc-8def-0123456789ab',
      );
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_NOT_FOUND');
    });

    it('404: 탈퇴한 유저 — 비존재와 구분하지 않는다', async () => {
      await request(server)
        .delete('/users/me')
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(204);

      const { status, body } = await getUser(otherId, meToken);
      expect(status).toBe(404);
      expect(body.errorCode).toBe('USER_NOT_FOUND');
    });

    it('400: uuid가 아닌 id — me 라우트가 여기로 새지 않는지의 대조군', async () => {
      const { status } = await getUser('not-a-uuid');
      expect(status).toBe(400);
    });

    it('200: /users/me는 여전히 me 라우트다 — :userId가 삼키지 않는다', async () => {
      const { status, body } = await getMe(meToken);
      expect(status).toBe(200);
      // 본인 전용 값이 살아있다 = :userId 핸들러로 새지 않았다.
      expect(body.email).toBe('test@example.com');
    });

    it('401: 손상된 토큰 — 만료를 익명으로 조용히 강등하지 않는다', async () => {
      const { status, body } = await getUser(otherId, 'not-a-jwt');
      expect(status).toBe(401);
      expect(body.errorCode).toBe('UNAUTHENTICATED');
    });

    it('뷰어별 응답이라 공유 캐시를 금지한다', async () => {
      const res = await request(server).get(`/users/${otherId}`);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['vary']).toContain('Authorization');
    });
  });
});
