import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
import { plants, userPlants, waterings } from '../../../database/schema';

// 마지막 물 준 날 — 상관 스칼라 서브쿼리. "다음 예정일" 파생(query service)의 원료로,
// 저장하지 않는 값이라 읽기 경로에서 매번 계산한다. UNIQUE_WATERINGS_PLANT_DATE의
// btree가 (user_plant_id) prefix로 커버해 행당 인덱스 스캔 1회. DATE 컬럼은 drizzle이
// driver 파서를 끄므로 max()도 raw 'YYYY-MM-DD' 문자열로 도착한다(sql 타입 주석 근거).
const LAST_WATERED_ON = sql<string | null>`(
  select max(${waterings.wateredOn}) from ${waterings}
  where ${waterings.userPlantId} = ${userPlants.id}
)`;

// 내 식물 read model의 원천 행 — 부분 select. 새 컬럼은 여기 명시적으로 추가해야
// 읽기 경로에 들어온다(옵트인). ownerId는 응답에 안 나가므로 제외(요청자 = 소유자).
const USER_PLANT_ROW = {
  id: userPlants.id,
  name: userPlants.name,
  images: userPlants.images,
  adoptedAt: userPlants.adoptedAt,
  memo: userPlants.memo,
  wateringIntervalDays: userPlants.wateringIntervalDays,
  lastWateredOn: LAST_WATERED_ON,
  createdAt: userPlants.createdAt,
  // 연결된 카탈로그 요약 — 중첩 셀렉션은 left join 미매칭 시 drizzle이 객체 전체를
  // null로 접는다(타입·런타임 모두) → plant: {…} | null 이 그대로 read model이 된다.
  plant: { id: plants.id, name: plants.name },
};

// 목록 프로젝션 — memo 제외(상세 전용), 대신 카탈로그 images 포함: 개체 사진이
// 없을 때 커버를 카탈로그 대표로 폴백하는 재료(응답엔 안 나감, query service가 소비).
// 중첩 객체 안에 두는 이유 — 미연결(join 미매칭)이면 plant째 null로 접혀 타입이 정직하다.
// 물주기 필드는 목록에도 — D-day 뱃지가 목록 화면의 핵심 소비처다.
const USER_PLANT_LIST_ROW = {
  id: userPlants.id,
  name: userPlants.name,
  images: userPlants.images,
  adoptedAt: userPlants.adoptedAt,
  wateringIntervalDays: userPlants.wateringIntervalDays,
  lastWateredOn: LAST_WATERED_ON,
  createdAt: userPlants.createdAt,
  plant: { id: plants.id, name: plants.name, images: plants.images },
};

// 읽기 어댑터 — 순수 DB 접근. plants 테이블 직접 join은 모듈 경계 위반이 아니라
// CQRS 읽기의 정상 경로다(read model은 테이블을 횡단한다) — PlantModule 경유(추가
// 쿼리)는 순수성 의례일 뿐. 쓰기 쪽 결합은 이미 FK가 DB 레벨에서 갖고 있다.
@Injectable()
export class UserPlantReader {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // owner 스코프 — 타인 개체는 비존재와 동일하게 null(존재 은닉, 404 하나로 수렴).
  async findById(id: string, ownerId: string) {
    const [row] = await this.db
      .select(USER_PLANT_ROW)
      .from(userPlants)
      .leftJoin(plants, eq(userPlants.plantId, plants.id))
      .where(and(eq(userPlants.id, id), eq(userPlants.ownerId, ownerId)));
    return row ?? null;
  }

  // keyset 페이지네이션 — plant 카탈로그와 동일 패턴(uuidv7 id DESC = 최신순).
  // owner 필터는 idx_user_plants_owner가 커버(개인 컬렉션 규모라 복합 인덱스 불필요).
  // ⚠️ hasMore 판별용으로 limit+1개까지 반환한다(n+1) — 자르기·nextCursor는 호출자 몫.
  async findPageRows(params: {
    ownerId: string;
    cursor?: string;
    limit: number;
  }) {
    return this.db
      .select(USER_PLANT_LIST_ROW)
      .from(userPlants)
      .leftJoin(plants, eq(userPlants.plantId, plants.id))
      .where(
        and(
          eq(userPlants.ownerId, params.ownerId),
          params.cursor ? lt(userPlants.id, params.cursor) : undefined,
        ),
      )
      .orderBy(desc(userPlants.id))
      .limit(params.limit + 1);
  }

  // watering 하위 리소스의 소유권 체크 — 존재+소유를 한 쿼리로(행 내용 불필요).
  // 소유권은 유니크/FK 제약이 못 주는 진실이라 사전 SELECT가 불가피한 경우다(§7 예외).
  async exists(id: string, ownerId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: userPlants.id })
      .from(userPlants)
      .where(and(eq(userPlants.id, id), eq(userPlants.ownerId, ownerId)))
      .limit(1);
    return rows.length > 0;
  }
}
