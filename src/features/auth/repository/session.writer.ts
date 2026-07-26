import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { DrizzleDB } from '../../../database/drizzle.constants';
import type { DrizzleTransactionalAdapter } from '../../../database/drizzle-transactional.adapter';
import { ClientPlatform } from '../domain/client-platform';
import { sessions } from '../../../database/schema/auth.schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class SessionWriter {
  constructor(
    private readonly txHost: TransactionHost<DrizzleTransactionalAdapter>,
  ) {}

  // 진행 중인 트랜잭션이 있으면 그 핸들을, 없으면 평범한 db를 준다(CLS가 고른다) —
  // 덕분에 이 어댑터의 쿼리는 트랜잭션 안팎에서 같은 코드로 동작한다.
  private get db(): DrizzleDB {
    return this.txHost.tx;
  }

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
