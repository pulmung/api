import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
import { genera, species } from '../../../database/schema';

// 속/종 사전 읽기 — 셀렉트박스 선택지 공급(도메인·유스케이스 우회, §2).
// ⚠️ 정렬에 COLLATE "C" 필수: DB 기본 collation(glibc en_US.utf8 등)은 한글을
// 가나다순으로 정렬하지 않는다(E2E로 발견). C = 코드포인트순 = 완성형 한글
// 가나다순이며 모든 Postgres에 존재 → DB 로케일과 무관하게 결정적.
@Injectable()
export class PlantDictionaryReader {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findGenusNames(): Promise<string[]> {
    const rows = await this.db
      .select({ name: genera.name })
      .from(genera)
      .orderBy(asc(sql`${genera.name} collate "C"`));
    return rows.map((row) => row.name);
  }

  async findSpeciesNames(genus: string): Promise<string[]> {
    const rows = await this.db
      .select({ name: species.name })
      .from(species)
      .where(eq(species.genus, genus))
      .orderBy(asc(sql`${species.name} collate "C"`));
    return rows.map((row) => row.name);
  }
}
