import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
import { userPlants, waterings } from '../../../database/schema';

// 물주기 기록 read model — createdAt 제외(클라 요구 없음). 두 필드 모두 문자열
// passthrough(date는 string 모드)라 변환이 0 → controller가 reader 직행으로 소비한다(§2).
const WATERING_ROW = {
  id: waterings.id,
  wateredOn: waterings.wateredOn,
};

@Injectable()
export class WateringReader {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // 멱등 재기록 경로 — 유니크 (userPlantId, wateredOn)로 기존 행 조회.
  // owner join 스코프: 행 존재만으로는 "내 것"이 증명되지 않는다(타인 개체면 404여야 함).
  async findByPlantAndDate(params: {
    userPlantId: string;
    ownerId: string;
    wateredOn: string;
  }) {
    const [row] = await this.db
      .select(WATERING_ROW)
      .from(waterings)
      .innerJoin(userPlants, eq(waterings.userPlantId, userPlants.id))
      .where(
        and(
          eq(waterings.userPlantId, params.userPlantId),
          eq(waterings.wateredOn, params.wateredOn),
          eq(userPlants.ownerId, params.ownerId),
        ),
      );
    return row ?? null;
  }

  // keyset 페이지네이션 — cursor = 이전 페이지 마지막 wateredOn. UNIQUE 제약 덕에 개체 내
  // 전순서라 tie-breaker가 필요 없고, backfill로 뒤늦게 넣은 기록도 날짜순 제자리에 선다.
  // UNIQUE_WATERINGS_PLANT_DATE btree가 eq + lt + ORDER BY DESC를 통째로 커버.
  // ⚠️ hasMore 판별용으로 limit+1개까지 반환한다 — 자르기·nextCursor는 호출자 몫.
  async findPageRows(params: {
    userPlantId: string;
    ownerId: string;
    cursor?: string;
    limit: number;
  }) {
    return this.db
      .select(WATERING_ROW)
      .from(waterings)
      .innerJoin(userPlants, eq(waterings.userPlantId, userPlants.id))
      .where(
        and(
          eq(waterings.userPlantId, params.userPlantId),
          eq(userPlants.ownerId, params.ownerId),
          params.cursor ? lt(waterings.wateredOn, params.cursor) : undefined,
        ),
      )
      .orderBy(desc(waterings.wateredOn))
      .limit(params.limit + 1);
  }
}
