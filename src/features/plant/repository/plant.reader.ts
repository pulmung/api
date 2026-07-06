import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, lt } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
import { plants } from '../../../database/schema';

// 카탈로그 read model의 원천 행 — 목록·단건이 같은 프로젝션 공유(부분 select).
// 새 컬럼은 여기 명시적으로 추가해야만 읽기 경로에 들어온다(옵트인).
const PLANT_ROW = {
  id: plants.id,
  name: plants.name,
  images: plants.images,
  genus: plants.genus,
  species: plants.species,
  category: plants.category,
  createdAt: plants.createdAt,
};

// 카탈로그 읽기 어댑터 — 순수 DB 접근. 반환 타입은 부분 select 추론에 맡긴다(CLAUDE.md 타입).
// read model 조합(URL·커버·ISO)은 application의 PlantQueryService 몫 — 여기 두지 않는다.
@Injectable()
export class PlantReader {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // keyset 페이지네이션: uuidv7은 선두 48비트가 타임스탬프(바이트 정렬 = 시간 정렬)라
  // id DESC = 최신순이고 PK 인덱스가 그대로 커버한다(추가 인덱스·정렬 키 불필요).
  // ⚠️ hasMore 판별용으로 limit+1개까지 반환한다(n+1) — 자르기·nextCursor는 호출자 몫.
  async findPageRows(params: { cursor?: string; limit: number }) {
    return this.db
      .select(PLANT_ROW)
      .from(plants)
      .where(params.cursor ? lt(plants.id, params.cursor) : undefined)
      .orderBy(desc(plants.id))
      .limit(params.limit + 1);
  }

  async findById(id: string) {
    const [row] = await this.db
      .select(PLANT_ROW)
      .from(plants)
      .where(eq(plants.id, id));
    return row ?? null;
  }
}
