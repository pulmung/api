import { pgTable, timestamp, uuid, text } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

export const users = pgTable('users', {
  id: uuid()
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  email: text().notNull(),
  name: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

// 타입 추론: 쿼리 결과(select) / 삽입(insert)용 타입을 스키마에서 자동 생성
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
