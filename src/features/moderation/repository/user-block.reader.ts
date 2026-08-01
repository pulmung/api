import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { DrizzleDB } from '../../../database/drizzle.constants';
import type { DrizzleTransactionalAdapter } from '../../../database/drizzle-transactional.adapter';
import { userBlocks, users } from '../../../database/schema';
import { userSummaryColumns } from '../../user/repository/user-summary.columns';

// 읽기 어댑터 — 순수 DB 접근. users 직접 join은 모듈 경계 위반이 아니라 CQRS 읽기의
// 정상 경로다(post.reader 전례).
@Injectable()
export class UserBlockReader {
  constructor(
    private readonly txHost: TransactionHost<DrizzleTransactionalAdapter>,
  ) {}

  // 진행 중인 트랜잭션이 있으면 그 핸들을, 없으면 평범한 db를 준다(CLS가 고른다).
  private get db(): DrizzleDB {
    return this.txHost.tx;
  }

  /**
   * 내가 차단한 유저 목록 — keyset 페이지네이션.
   *
   * 커서·정렬 기준이 createdAt(최근 차단순)이 아니라 blockedId ASC인 이유: pk_user_blocks
   * (blocker_id, blocked_id)가 필터·정렬·커서를 인덱스 하나로 통째로 커버한다. 이 목록의
   * 용도는 차단 해제 UI라 순서 자체에 의미가 없고, id는 유니크해서 tie-break 복합 커서도
   * 필요 없다. ("최근 차단순"이 실제로 요구되면 (blocker_id, created_at) 인덱스를 그때
   * 추가한다 — 인덱스는 쿼리가 정한다.)
   *
   * inner join(users): blocked_id는 notNull + onDelete cascade라 상대 행이 항상 존재한다.
   * ⚠️ hasMore 판별용으로 limit+1개까지 반환한다(n+1) — 자르기·nextCursor는 호출자 몫.
   */
  async findPageRows(params: {
    blockerId: string;
    cursor?: string;
    limit: number;
  }) {
    return this.db
      .select({
        // 차단 관계에 surrogate id가 없으므로(순수 관계 테이블) 커서는 상대 유저 id다.
        // projection 조각은 user 소유 — URL 조합은 query service 몫(post·comment 전례).
        user: userSummaryColumns(users),
        createdAt: userBlocks.createdAt,
      })
      .from(userBlocks)
      .innerJoin(users, eq(userBlocks.blockedId, users.id))
      .where(
        and(
          eq(userBlocks.blockerId, params.blockerId),
          params.cursor ? gt(userBlocks.blockedId, params.cursor) : undefined,
        ),
      )
      .orderBy(asc(userBlocks.blockedId))
      .limit(params.limit + 1);
  }
}
