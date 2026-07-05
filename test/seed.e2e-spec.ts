import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { DrizzleDB } from '../src/database/drizzle.constants';
import { genera, species } from '../src/database/schema';
import { plantDictionaryData } from '../src/database/seed/plant-dictionary.data';
import { seedPlantDictionary } from '../src/database/seed/plant-dictionary.seed';
import { createPostgresContainer } from './helpers/setup-e2e';

// HTTP 없는 스크립트 테스트지만 docker(testcontainers)가 필요해서 e2e 프로젝트에 편입.
// setupE2E는 안 쓴다 — Nest 앱이 불필요(컨테이너 + 마이그레이션 + 시드 함수 직접 호출).
describe('PlantDictionary seed (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: DrizzleDB;

  const generaTotal = Object.keys(plantDictionaryData).length;
  const speciesTotal = Object.values(plantDictionaryData).flat().length;

  const countRows = async () => ({
    genera: (await db.select().from(genera)).length,
    species: (await db.select().from(species)).length,
  });

  beforeAll(async () => {
    container = await createPostgresContainer().start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    db = drizzle({ client: pool });
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it('첫 실행: 데이터 파일 전체가 삽입된다', async () => {
    const result = await seedPlantDictionary(db, plantDictionaryData);

    expect(result).toEqual({
      generaInserted: generaTotal,
      generaSkipped: 0,
      speciesInserted: speciesTotal,
      speciesSkipped: 0,
    });
    expect(await countRows()).toEqual({
      genera: generaTotal,
      species: speciesTotal,
    });
  });

  it('재실행: 아무것도 삽입하지 않는다 (멱등)', async () => {
    const result = await seedPlantDictionary(db, plantDictionaryData);

    expect(result).toEqual({
      generaInserted: 0,
      generaSkipped: generaTotal,
      speciesInserted: 0,
      speciesSkipped: speciesTotal,
    });
    expect(await countRows()).toEqual({
      genera: generaTotal,
      species: speciesTotal,
    });
  });

  it('수렴: 지워진 행만 다시 채운다', async () => {
    // 종이 있는 첫 속에서 한 행 삭제 (genus 삭제는 FK restrict라 species로)
    const [genus, names] = Object.entries(plantDictionaryData).find(
      ([, v]) => v.length > 0,
    )!;
    await db
      .delete(species)
      .where(and(eq(species.genus, genus), eq(species.name, names[0])));

    const result = await seedPlantDictionary(db, plantDictionaryData);

    expect(result.speciesInserted).toBe(1);
    expect(result.generaInserted).toBe(0);
    expect(await countRows()).toEqual({
      genera: generaTotal,
      species: speciesTotal,
    });
  });

  it('검증 우선: 잘못된 데이터는 삽입 전에 throw', async () => {
    await expect(
      seedPlantDictionary(db, { 테스트속: ['가', '가'] }),
    ).rejects.toThrow('중복');
    await expect(
      seedPlantDictionary(db, { ' 공백속': [] }),
    ).rejects.toThrow('공백');

    // 아무것도 안 들어갔다 — validate가 트랜잭션보다 먼저임을 증명
    expect(await countRows()).toEqual({
      genera: generaTotal,
      species: speciesTotal,
    });
  });
});
