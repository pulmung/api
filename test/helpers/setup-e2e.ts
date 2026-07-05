import { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { SocialIdentityVerifier } from '../../src/features/auth/infrastructure/social/identity.verifier';
import { S3FileStorage } from '../../src/features/file/infrastructure/s3-file.storage';
import { AppModule } from '../../src/app.module';
import { DRIZZLE } from '../../src/database/drizzle.constants';

export type FakeFileStorage = Pick<
  S3FileStorage,
  'createUploadTarget' | 'head'
> & {
  missingKeys: Set<string>;
};

// 운영/로컬 DB와 동일한 collation 정책(builtin C.UTF-8 — 한글 코드포인트 정렬)으로
// 컨테이너를 만든다. CLAUDE.md "정렬 (collation)" 참조. 컨테이너를 직접 띄우는
// 테스트(시드 등)도 반드시 이 팩토리를 쓴다 — 아니면 en_US.utf8로 떠서 정렬이 갈린다.
export function createPostgresContainer(): PostgreSqlContainer {
  return new PostgreSqlContainer('postgres:18.4').withEnvironment({
    POSTGRES_INITDB_ARGS: '--locale-provider=builtin --builtin-locale=C.UTF-8',
  });
}

export async function setupE2E(extraControllers: Type[] = []) {
  const container = await createPostgresContainer().start();

  // ConfigModule 검증 통과용 테스트 env
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.JWT_ACCESS_SECRET = 'test-secret';
  process.env.GOOGLE_CLIENT_IDS = 'test-google-id';
  process.env.KAKAO_APP_ID = '12345';
  process.env.REFRESH_TOKEN_TTL_DAYS = '30';
  process.env.TRUST_PROXY_HOPS = '0';
  process.env.AWS_REGION = 'ap-northeast-2';
  process.env.S3_PUBLIC_FILE_BUCKET = 'test-bucket';

  // 스키마 마이그레이션 (drizzle.config의 out 경로 확인 — 보통 ./drizzle)
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  const testDb = drizzle({ client: pool });
  await migrate(testDb, { migrationsFolder: './drizzle' });

  const fakeVerifier: Pick<SocialIdentityVerifier, 'verify'> = {
    verify: (input) =>
      Promise.resolve({
        provider: input.provider,
        providerUserId: input.accessToken,
        email: 'test@example.com',
      }),
  };

  // real S3Client 미생성 → E2E에 AWS 자격증명 불필요
  // head 기본값 = "존재" (해피패스 무설정) — missingKeys에 넣은 key만 미업로드 시뮬레이션.
  const missingKeys = new Set<string>();
  const fakeStorage: FakeFileStorage = {
    createUploadTarget: ({ key, contentType }) =>
      Promise.resolve({
        url: 'https://test-bucket.s3.ap-northeast-2.amazonaws.com/',
        fields: {
          key,
          'Content-Type': contentType,
          Policy: 'fake-policy',
          'X-Amz-Signature': 'fake-signature',
        },
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    head: (key) =>
      Promise.resolve(missingKeys.has(key) ? null : { size: 1234 }),
    missingKeys,
  };

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extraControllers,
  })
    .overrideProvider(DRIZZLE)
    .useValue(testDb)
    .overrideProvider(SocialIdentityVerifier)
    .useValue(fakeVerifier)
    .overrideProvider(S3FileStorage)
    .useValue(fakeStorage)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  return { app, container, db: testDb, pool, fakeStorage };
}
