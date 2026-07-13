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

  // 정상 회전: 검증에 성공한 현재 해시를 prev로 pin하고 grace 타이머 시작.
  // prev는 SQL 자기참조가 아니라 검증된 해시를 명시적으로 받는다 —
  // 동시 정상 회전 레이스에서도 양쪽 다 같은 값으로 수렴해야 하므로.
  async rotate(
    sessionId: string,
    input: { tokenHash: string; prevTokenHash: string },
  ) {
    await this.db
      .update(sessions)
      .set({ ...input, rotatedAt: new Date(), lastUsedAt: new Date() })
      .where(eq(sessions.id, sessionId));
  }

  // grace 회전: cur만 교체. prev·rotatedAt은 pin 유지 — N개 탭 통과 + grace 연장 불가
  async graceRotate(sessionId: string, tokenHash: string) {
    await this.db
      .update(sessions)
      .set({ tokenHash, lastUsedAt: new Date() })
      .where(eq(sessions.id, sessionId));
  }

  async revoke(sessionId: string) {
    await this.db.delete(sessions).where(eq(sessions.id, sessionId));
  }
}
