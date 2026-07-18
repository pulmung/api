import { uuid, date, timestamp, unique } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { pgTable } from './table';
import { userPlants } from './user-plant.schema';

// 문장 실행 중 부모 개체가 동시 삭제되면(23503) 도메인 예외로 변환하기 위한 명시적 FK 이름
// (user_plants의 FK_USER_PLANTS_PLANT와 같은 결 — §7 원칙의 FK 버전, 상수로 단일 소스).
export const FK_WATERINGS_USER_PLANT = 'fk_waterings_user_plant';
// "오늘 물 줬어요"를 더블탭해도 한 개체·하루 한 기록. 이 유니크가 onConflictDoNothing의 target이자
// 멱등의 근거다. 동시에 (user_plant_id, watered_on) btree가 목록 조회의 커버 인덱스가 된다(아래).
export const UNIQUE_WATERINGS_PLANT_DATE = 'uq_waterings_plant_date';

/**
 * 물주기 기록 — 내 식물(user_plants) 개체에 종속된 하위 리소스. "우리집 몬스테라에 오늘 물 줬다"
 * 한 건이 한 행이다. 개체가 사라지면 기록도 의미 없으므로 onDelete: cascade.
 *
 * wateredOn이 timestamptz가 아니라 date인 이유: "물 준 날"은 유저의 로컬 달력 날짜지 절대 시점이
 * 아니다. 서버는 유저의 타임존(→ 유저에게 "오늘"이 언제인지)을 모르므로, 클라가 자기 로컬 달력
 * 날짜를 보낸다(user_plants.adoptedAt과 동일 논리). 시각·타임존을 붙이면 자정 근처에서 "어제/오늘"이
 * 서버 타임존으로 어긋난다. createdAt(감사용 실제 시점)만 timestamptz.
 */
export const waterings = pgTable(
  'waterings',
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userPlantId: uuid()
      .notNull()
      .references(() => userPlants.id, {
        name: FK_WATERINGS_USER_PLANT,
        onDelete: 'cascade',
      }),

    // 물 준 날 (유저 로컬 달력 날짜, 'YYYY-MM-DD'). date는 drizzle string 모드라 변환 없이 왕복.
    // 과거 backfill·미래 날짜를 막지 않는다 — 서버가 유저의 "오늘"을 모르므로 경계를 못 긋는다.
    wateredOn: date().notNull(),

    // 기록이 만들어진 실제 시점(감사·정렬 보조). 여긴 절대 시점이라 timestamptz.
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // 한 개체·하루 한 기록(멱등의 근거). 이 복합 유니크가 만드는 btree는 leftmost prefix로
    // ① "이 개체의 물주기 이력"(WHERE user_plant_id = ? ORDER BY watered_on DESC) 조회와
    // ② FK cascade 삭제 시 자식 행 스캔까지 커버한다 → 별도 FK 인덱스를 만들지 않는다.
    unique(UNIQUE_WATERINGS_PLANT_DATE).on(t.userPlantId, t.wateredOn),
  ],
);

export type Watering = typeof waterings.$inferSelect;
export type NewWatering = typeof waterings.$inferInsert;
