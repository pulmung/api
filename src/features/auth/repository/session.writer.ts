import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
import { ClientPlatform } from '../domain/client-platform';
import { sessions } from '../../../database/schema/auth.schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class SessionWriter {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(input: {
    id: string;
    userId: string;
    tokenHash: string;
    platform: ClientPlatform;
    deviceName: string | null;
    userAgent: string | null;
    ip: string | null;
    expiresAt: Date;
  }) {
    await this.db.insert(sessions).values(input); // createdAt·lastUsedAt은 DB default
  }

  async rotate(sessionId: string, tokenHash: string) {
    await this.db
      .update(sessions)
      .set({ tokenHash, lastUsedAt: new Date() })
      .where(eq(sessions.id, sessionId));
  }

  async revoke(sessionId: string) {
    await this.db.delete(sessions).where(eq(sessions.id, sessionId));
  }
}
