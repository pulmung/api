import { timestamp, uuid, text, unique } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { pgTable } from './table';

/**
 * 지원하는 소셜 인증 제공자.
 * pgEnum(DB 타입) 대신 text + TS 유니온으로 둔다 → provider 추가가 코드 한 줄
 * (pgEnum은 ALTER TYPE 마이그레이션 필요). 들어오는 값은 앱이 통제한다.
 */
export const socialProviders = ['kakao', 'google'] as const;
export type SocialProvider = (typeof socialProviders)[number];

/**
 * 1유저 = 1소셜 계정. 계정 통합(linking)을 지원하지 않기로 한 결정에 따라
 * provider/providerUserId를 users에 직접 둔다(분리 테이블·조인 불필요).
 * 로그인 식별 키는 이메일이 아니라 (provider, providerUserId) — 소셜이 주는 영구 ID.
 */
export const users = pgTable(
  'users',
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    provider: text({ enum: socialProviders }).notNull(),
    // 소셜이 주는 고유 식별자(google sub / kakao id). 이메일이 아니라 이 값이 매칭 키.
    providerUserId: text().notNull(),
    // 소셜이 이메일을 안 줄 수 있다(카카오 미동의/Apple 비공개 릴레이 등). 식별이 아니라 프로필 데이터.
    email: text(),
    name: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  // 같은 소셜 계정으로 중복 가입 방지 + 로그인 시 조회 키
  (t) => [unique().on(t.provider, t.providerUserId)],
);

// 타입 추론: 쿼리 결과(select) / 삽입(insert)용 타입을 스키마에서 자동 생성
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
