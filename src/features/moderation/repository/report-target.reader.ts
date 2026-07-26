import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { DrizzleDB } from '../../../database/drizzle.constants';
import type { DrizzleTransactionalAdapter } from '../../../database/drizzle-transactional.adapter';
import { comments, posts, users } from '../../../database/schema';
import type { ReportTargetType } from '../domain/report-target-type';

/**
 * 신고 대상 판별 어댑터 — 대상이 실존하는지 + 그 작성자가 누구인지를 한 쿼리로.
 *
 * **여기가 다형 참조의 대가를 지불하는 곳이다.** 다른 테이블은 INSERT 후 23503을 잡아
 * 도메인 예외로 바꾸지만(§7 사전 SELECT 금지), reports는 FK가 없어서 잡을 위반이 없다
 * (왜 FK가 없는지는 report.table.ts doc). 그래서 사전 SELECT가 **불가피한 경우**다 —
 * CommentReader.findParentMeta가 "유니크/FK가 못 주는 진실"을 사전 조회하는 것과 같은 결.
 *
 * 다만 이 조회는 낭비가 아니다: 어차피 `reports.targetAuthorId`(소급 불가라 접수 시점에만
 * 채울 수 있는 컬럼)를 여기서 얻어야 하므로, 검증과 수집이 같은 쿼리 하나로 끝난다.
 *
 * posts·comments·users를 직접 select하는 것은 모듈 경계 위반이 아니다 — CQRS 읽기의
 * 테이블 횡단은 정상 경로다(post.reader가 users·plants를 join하는 것과 같다).
 */
@Injectable()
export class ReportTargetReader {
  constructor(
    private readonly txHost: TransactionHost<DrizzleTransactionalAdapter>,
  ) {}

  // 진행 중인 트랜잭션이 있으면 그 핸들을, 없으면 평범한 db를 준다(CLS가 고른다).
  private get db(): DrizzleDB {
    return this.txHost.tx;
  }

  /**
   * @returns 대상의 작성자 id / `null` = 대상 비존재(호출자가 404로 번역)
   *
   * targetType이 'user'면 대상 자신이 작성자다 — 결함이 아니라 정의다
   * (report-target-type.ts doc).
   */
  async findAuthorId(
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<string | null> {
    switch (targetType) {
      case 'post': {
        const [row] = await this.db
          .select({ authorId: posts.authorId })
          .from(posts)
          .where(eq(posts.id, targetId));
        return row?.authorId ?? null;
      }
      case 'comment': {
        // soft-deleted 제외 — 이미 삭제된 댓글은 신고 대상이 아니다(본문이 NULL로
        // 지워져 있어 심사할 것도 없다). 플레이스홀더만 남은 루트도 여기서 걸린다.
        const [row] = await this.db
          .select({ authorId: comments.authorId })
          .from(comments)
          .where(and(eq(comments.id, targetId), isNull(comments.deletedAt)));
        return row?.authorId ?? null;
      }
      case 'user': {
        const [row] = await this.db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, targetId));
        return row?.id ?? null;
      }
    }
  }
}
