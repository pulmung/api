import { Injectable } from '@nestjs/common';
import { DatabaseError } from 'pg';
import { and, DrizzleQueryError, eq } from 'drizzle-orm';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { DrizzleDB } from '../../../database/drizzle.constants';
import type { DrizzleTransactionalAdapter } from '../../../database/drizzle-transactional.adapter';
import { PG_ERROR_CODE } from '../../../database/postgres-error';
import {
  userBlocks,
  FK_USER_BLOCKS_BLOCKED,
  FK_USER_BLOCKS_BLOCKER,
} from '../../../database/schema';
import { UnauthenticatedError } from '../../auth/domain/auth.error';
import { BlockTargetNotFoundError } from '../domain/moderation.error';

/**
 * 차단 쓰기 어댑터 — `user_blocks` 한 테이블만 소유한다(PostLikeWriter와 같은 형태).
 *
 * 두 연산 모두 "실제로 바뀐 행이 있었는가"를 boolean으로 돌려준다 — 멱등 판정의 근거가
 * 앱 조건문이 아니라 DB다. 중복은 복합 PK(pk_user_blocks)가, 존재 판정은 영향받은 행 수가
 * 준다. 사전 SELECT("이미 차단했나?")를 두지 않는다 — 검사와 쓰기 사이에 경합이 생기고
 * 쿼리가 늘어난다(§7).
 *
 * 카운터가 없어 유스케이스가 트랜잭션을 열 이유도 없다(post_likes와 다른 점) — 단일
 * 문장이 곧 원자 단위다.
 */
@Injectable()
export class UserBlockWriter {
  constructor(
    private readonly txHost: TransactionHost<DrizzleTransactionalAdapter>,
  ) {}

  // 진행 중인 트랜잭션이 있으면 그 핸들을, 없으면 평범한 db를 준다(CLS가 고른다).
  private get db(): DrizzleDB {
    return this.txHost.tx;
  }

  /** @returns true = 이번에 새로 차단됨 / false = 이미 차단 상태(멱등) */
  async insertIfAbsent(blockerId: string, blockedId: string): Promise<boolean> {
    try {
      const inserted = await this.db
        .insert(userBlocks)
        .values({ blockerId, blockedId })
        .onConflictDoNothing({
          target: [userBlocks.blockerId, userBlocks.blockedId],
        })
        .returning({ blockedId: userBlocks.blockedId });
      return inserted.length > 0;
    } catch (e) {
      this.throwIfFkViolation(e);
      throw e;
    }
  }

  /**
   * @returns true = 이번에 실제로 해제됨 / false = 차단 상태가 아니었음(멱등)
   *
   * insertIfAbsent와 달리 FK 변환이 없다 — 자식 행 DELETE는 RI 검사를 태우지 않아
   * 23503이 발생할 경로가 없다(PostLikeWriter.delete와 같은 비대칭). "없는 유저의 차단
   * 해제"도 0행 = 멱등 성공으로 흡수한다: 이미 차단 상태가 아니라는 응답이 정확하다.
   */
  async delete(blockerId: string, blockedId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(userBlocks)
      .where(
        and(
          eq(userBlocks.blockerId, blockerId),
          eq(userBlocks.blockedId, blockedId),
        ),
      )
      .returning({ blockedId: userBlocks.blockedId });
    return deleted.length > 0;
  }

  // FK 위반(23503)을 도메인 예외로 변환 — 사전 SELECT 없음(post-like.writer와 같은 경로).
  private throwIfFkViolation(e: unknown): void {
    const cause = e instanceof DrizzleQueryError ? e.cause : e;
    if (
      !(cause instanceof DatabaseError) ||
      cause.code !== PG_ERROR_CODE.FOREIGN_KEY_VIOLATION
    ) {
      return; // 매치 안 되면 조용히 반환(호출부가 rethrow).
    }
    // 차단하려는 상대가 존재하지 않음(또는 그 사이 탈퇴) — 404.
    if (cause.constraint === FK_USER_BLOCKS_BLOCKED) {
      throw new BlockTargetNotFoundError();
    }
    // 탈퇴 직후 아직 만료 안 된 access token의 INSERT(무상태 검증이라 즉시 모름 — §10) — 401.
    if (cause.constraint === FK_USER_BLOCKS_BLOCKER) {
      throw new UnauthenticatedError();
    }
  }
}
