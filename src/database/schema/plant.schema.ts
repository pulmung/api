import {
  uuid,
  text,
  timestamp,
  index,
  primaryKey,
  jsonb,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { pgTable } from './table';
import { users } from './user.schema';
import { plantCategories } from '../../features/plant/domain/plant-category';
import type { PlantImage } from '../../features/plant/domain/plant-image';

export const PK_SPECIES = 'pk_species';
export const UNIQUE_PLANTS_NAME = 'uq_plants_name';

/**
 * 속(genus) 사전 — 셀렉트박스 선택지 공급용. admin 페이지 + seed로 큐레이션.
 * plants는 이 테이블을 FK로 참조하지 않는다(plants.genus는 자유 텍스트). 순수 제안 소스.
 * PK = name(자연키): 참조자는 species뿐이고, rename은 그쪽으로 onUpdate cascade 전파.
 */
export const genera = pgTable('genera', {
  name: text().primaryKey(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

/**
 * 종(species) 사전 — 속 아래 계층. "속 고르면 그 속의 종만" 캐스케이드 셀렉트용.
 * PK = (genus, name) 자연 복합키 → 이 인덱스가 "genus로 종 조회"까지 커버(별도 인덱스 불필요).
 * genus는 genera.name 참조: 속 rename은 onUpdate cascade로 전파, 삭제는 restrict(종 남으면 못 지움).
 * species를 FK로 참조하는 곳이 없으므로 surrogate id가 없어도 잃는 게 없다.
 */
export const species = pgTable(
  'species',
  {
    genus: text()
      .notNull()
      .references(() => genera.name, {
        onUpdate: 'cascade',
        onDelete: 'restrict',
      }),
    name: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ name: PK_SPECIES, columns: [t.genus, t.name] })],
);

/**
 * 식물(catalog) — 공유 카탈로그 엔트리. 정체성 = 식물명(종/품종 레벨).
 * 다른 유저의 '내 식물'·글이 이 행을 참조한다 → 중복 생성 금지(전역 유니크).
 */
export const plants = pgTable(
  'plants',
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    // 식물을 구분짓는 유일한 속성. 전역 유니크 → 중복 등록 금지(공유 카탈로그).
    name: text().notNull().unique(UNIQUE_PLANTS_NAME),
    // 이미지(필수, ≥1) — 단일 jsonb, 배열 of {key, width?, height?}. 첫 요소 = 대표/커버.
    // 저장은 불투명 key만(전체 URL 금지 — 버킷/CDN 이전 안전). 실존 검증(head)은 생성
    // usecase가, "최소 1장"·형식은 도메인 엔티티 + Zod 경계가 강제한다(docs/file-upload.md §6).
    images: jsonb().$type<PlantImage[]>().notNull(),

    // ── 메타데이터(옵셔널) ──────────────────────────
    // 속·종은 자유 텍스트(FK 없음). 셀렉트박스 선택지는 genera/species 사전(admin+seed)에서
    // 제안하되, 유저는 사전에 없는 값도 직접 입력 가능 → 저장값은 그냥 text.
    genus: text(), // 속
    species: text(), // 종
    // 카테고리 — 속/종과 별개 축. 큐레이션된 닫힌 집합(enum) → 자유입력 없음.
    category: text({ enum: plantCategories }),

    // ── 출처/감사 ───────────────────────────────────
    // 등록 유저. 카탈로그는 공유 자산이므로 유저가 사라져도 식물은 남긴다 → set null.
    createdById: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // 멀티필드 부분일치 검색(ILIKE '%q%') — name/genus/species를 OR로 묶고
    // greatest(가중 similarity)로 정확도순 정렬(name 가중치 최대). OR가 BitmapOr로
    // 인덱스를 타려면 세 컬럼 다 trgm GIN이어야 한다.
    // ⚠️ 마이그레이션에 `CREATE EXTENSION IF NOT EXISTS pg_trgm;`을 수동으로 넣어야 한다
    //    (drizzle-kit generate는 확장 생성을 자동으로 안 만든다).
    index('idx_plants_name_trgm').using('gin', t.name.op('gin_trgm_ops')),
    index('idx_plants_genus_trgm').using('gin', t.genus.op('gin_trgm_ops')),
    index('idx_plants_species_trgm').using('gin', t.species.op('gin_trgm_ops')),
  ],
);

export type Genus = typeof genera.$inferSelect;
export type NewGenus = typeof genera.$inferInsert;
export type Species = typeof species.$inferSelect;
export type NewSpecies = typeof species.$inferInsert;
export type Plant = typeof plants.$inferSelect;
export type NewPlant = typeof plants.$inferInsert;
