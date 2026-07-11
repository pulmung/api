import { uuid, text, timestamp, date, index, jsonb } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { pgTable } from './table';
import { users } from './user.schema';
import { plants } from './plant.schema';
import type { PlantImage } from '../../features/plant/domain/plant-image';

export const FK_USER_PLANTS_PLANT = 'fk_user_plants_plant';

/**
 * 내 식물 — 유저가 실제로 키우는 개체(individual). 카탈로그(plants)가 "종/품종"이라면
 * 이 테이블은 "우리 집 몬스테라 한 그루"다. 물주기 스케줄·성장 기록·피드 사진이
 * 앞으로 이 행에 붙는다(additive — 지금은 넣지 않는다, YAGNI).
 *
 * (owner, plant) 유니크 없음 — 같은 종을 두 개체 키우는 건 정상이다(몬스테라 2개).
 * 개체의 정체성은 자연키가 아니라 surrogate id.
 */
export const userPlants = pgTable(
  'user_plants',
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // 카탈로그 참조 — 옵셔널. "무슨 식물인지 모름"은 정당한 상태다: 필수로 강제하면
    // ① 등록 마찰(리텐션 후크 진입 장벽) ② 모르는 유저가 통과용 쓰레기 엔트리("우리집
    // 나무")로 공유 카탈로그(전역 유니크 이름)를 오염시킨다. null → 나중에 식물이
    // 동정(identification)되면 PATCH로 연결하는 승격 경로.
    // set null: 카탈로그 행이 지워지면 개체는 "모름"으로 강등 — 어차피 정당한 상태다.
    // restrict였다면 쓰레기 엔트리를 만든 본인의 개체가 참조 중이라 admin이 정리를 못 한다.
    // ⚠️ 중복 병합 목적 삭제는 먼저 re-point하고 지울 것(안 그러면 연결이 조용히 소실).
    // 명시적 FK 이름: 값이 있을 때 사전 SELECT 대신 INSERT 후 23503을 잡아 도메인
    // 예외로 변환하기 위함(§7 원칙의 FK 버전 — 23505와 같은 경로).
    plantId: uuid().references(() => plants.id, {
      name: FK_USER_PLANTS_PLANT,
      onDelete: 'set null',
    }),

    // 개체의 이름(애칭 "초록이"). nickname이 아닌 name: 이 코드베이스에서 nickname은
    // 사람(users.nickname)의 용어이고, 엔티티의 이름은 name이 관례(plants.name, genera.name).
    // 부르는 이름이므로 필수 — 유니크는 아니다(내 식물끼리도 중복 허용, 강제할 불변식이
    // 아니라 유저 자유). 클라가 카탈로그 이름을 기본값으로 프리필하면 마찰 없음.
    name: text().notNull(),

    // 개체 사진 — 카탈로그 images(≥1 필수)와 달리 빈 배열 허용: 사진 없이도 등록 가능해야
    // 등록 마찰이 낮다(plantId가 있으면 대표 이미지를 카탈로그로 폴백, 둘 다 없으면 UI
    // 플레이스홀더). 형식은 plant와 동일 규약(불투명 key만 저장, docs/file-upload.md §6).
    images: jsonb().$type<PlantImage[]>().notNull(),

    // 데려온 날 — 시각·타임존이 무의미한 달력 날짜라 timestamptz가 아니라 date.
    // 유저 기억에 의존하는 과거 날짜 입력이므로 옵셔널.
    adoptedAt: date(),

    memo: text(),

    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // 핵심 쿼리 "내 식물 목록"(WHERE owner_id = ?). PG는 FK에 인덱스를 자동 생성하지 않는다.
    index('idx_user_plants_owner').on(t.ownerId),
    // ① plants 삭제 시 set null 전파가 참조 행을 찾을 때 스캔 ② "이 식물 키우는 유저" 역조회.
    index('idx_user_plants_plant').on(t.plantId),
  ],
);

export type UserPlant = typeof userPlants.$inferSelect;
export type NewUserPlant = typeof userPlants.$inferInsert;
