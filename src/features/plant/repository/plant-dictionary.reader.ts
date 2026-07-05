import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
import { genera, species } from '../../../database/schema';

// 속/종 사전 읽기 — 셀렉트박스 선택지 공급(도메인·유스케이스 우회, §2).
// 이름 정렬(가나다순)은 DB 기본 collation(builtin C.UTF-8 = 코드포인트순)이 보장한다
// — 쿼리에 COLLATE를 명시하지 않는다 (CLAUDE.md "정렬 (collation)" 참조).
@Injectable()
export class PlantDictionaryReader {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findGenusNames(): Promise<string[]> {
    const rows = await this.db
      .select({ name: genera.name })
      .from(genera)
      .orderBy(asc(genera.name));
    return rows.map((row) => row.name);
  }

  async findSpeciesNames(genus: string): Promise<string[]> {
    const rows = await this.db
      .select({ name: species.name })
      .from(species)
      .where(eq(species.genus, genus))
      .orderBy(asc(species.name));
    return rows.map((row) => row.name);
  }
}
