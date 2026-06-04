import { timestamp, uuid, text, unique } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { pgTable } from './table';
import { socialProviders } from '../../features/user/domain/social-provider';

export const UNIQUE_USERS_NICKNAME = 'uq_users_nickname';
export const UNIQUE_USERS_PROVIDER_ACCOUNT = 'uq_users_provider_account';

export const users = pgTable(
  'users',
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    provider: text({ enum: socialProviders }).notNull(),
    providerUserId: text().notNull(),
    // 소셜이 이메일을 안 줄 수 있다(카카오 미동의/Apple 비공개 릴레이 등). 식별이 아니라 프로필 데이터.
    email: text(),
    // 유저가 직접 입력. 전역 유니크 — 중복 닉네임 금지.
    nickname: text().notNull().unique(UNIQUE_USERS_NICKNAME),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique(UNIQUE_USERS_PROVIDER_ACCOUNT).on(t.provider, t.providerUserId),
  ],
);

// 타입 추론: 쿼리 결과(select) / 삽입(insert)용 타입을 스키마에서 자동 생성
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
