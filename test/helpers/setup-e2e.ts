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

export async function setupE2E(extraControllers: Type[] = []) {
  const container = await new PostgreSqlContainer('postgres:18.4').start();

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
  const fakeStorage: Pick<S3FileStorage, 'createUploadTarget'> = {
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

  return { app, container, db: testDb, pool };
}
