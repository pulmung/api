import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { z } from 'zod';
import { plantDictionaryData } from './plant-dictionary.data';
import { seedPlantDictionary } from './plant-dictionary.seed';

// 시드 엔트리 — 로컬: `npm run db:seed`(tsx), prod: `node dist/database/seed/run.js`
// (SWC 빌더가 src 전체를 dist로 컴파일하고 dotenv·pg·drizzle·zod는 prod dep이라 가능).
// AppModule/ConfigModule을 쓰지 않는다 — 전체 env 스키마(JWT·AWS…)가 강제되므로,
// 쓰는 키(DATABASE_URL)만 검증한다(fail-fast 철학은 docs/config.md와 동일).
const envSchema = z.object({ DATABASE_URL: z.url() });

async function main() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`❌ 환경변수 검증 실패:\n${z.prettifyError(result.error)}`);
  }

  const pool = new Pool({ connectionString: result.data.DATABASE_URL });
  try {
    const db = drizzle({ client: pool });
    const counts = await seedPlantDictionary(db, plantDictionaryData);
    console.log('✅ plant dictionary seed 완료:', counts);
  } finally {
    await pool.end();
  }
}

// process.exit()이 아니라 exitCode — pool이 정상적으로 drain되게 둔다.
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
