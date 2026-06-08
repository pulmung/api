import { uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { pgTable } from './table';
import { uuidv7 } from 'uuidv7';
import { users } from './user.schema';
import { clientPlatforms } from '../../features/auth/domain/client-platform';

export const sessions = pgTable('sessions', {
  id: uuid()
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text().notNull(), // refresh secret의 sha256
  platform: text({ enum: clientPlatforms }).notNull(),
  deviceName: text(), // 앱이 보낸 기기명("iPhone 15 Pro"). 웹은 null
  userAgent: text(), // 웹 raw UA(표시 시 파싱). 앱은 보통 null
  ip: text(),

  lastUsedAt: timestamp({ withTimezone: true }).defaultNow().notNull(), // refresh 시 갱신
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});
