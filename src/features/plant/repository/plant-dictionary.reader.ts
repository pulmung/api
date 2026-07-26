import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { DrizzleDB } from '../../../database/drizzle.constants';
import type { DrizzleTransactionalAdapter } from '../../../database/drizzle-transactional.adapter';
import { genera, species } from '../../../database/schema';

// 속/종 사전 읽기 — 셀렉트박스 선택지 공급(도메인·유스케이스 우회, §2).
// 이름 정렬(가나다순)은 DB 기본 collation(builtin C.UTF-8 = 코드포인트순)이 보장한다
// — 쿼리에 COLLATE를 명시하지 않는다 (CLAUDE.md "정렬 (collation)" 참조).
@Injectable()
export class PlantDictionaryReader {
  constructor(
    private readonly txHost: TransactionHost<DrizzleTransactionalAdapter>,
  ) {}

  // 진행 중인 트랜잭션이 있으면 그 핸들을, 없으면 평범한 db를 준다(CLS가 고른다) —
  // 덕분에 이 어댑터의 쿼리는 트랜잭션 안팎에서 같은 코드로 동작한다.
  private get db(): DrizzleDB {
    return this.txHost.tx;
  }

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
