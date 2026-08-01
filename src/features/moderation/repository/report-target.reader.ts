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
   * @returns `null` = 대상 비존재(호출자가 404로 번역) /
   *   객체 = 대상 존재. 그 안의 `authorId`가 `null`이면 **대상은 살아있는데 작성자가
   *   탈퇴**했다는 뜻이다 — 그 댓글도 신고할 수 있어야 하므로 404가 아니다.
   *   탈퇴가 신고 회피 수단이 되면 안 된다.
   *   ⚠️ 이 상태는 **댓글에만 생긴다**(comments.authorId만 set null). 글은 작성자 탈퇴 시
   *   함께 사라지므로 신고하면 그냥 바깥 `null`(=404)이다 — post 분기의 authorId는 사실상
   *   항상 값이 있다(컬럼이 notNull이라 타입도 그렇게 좁혀진다).
   *
   * ⚠️ 이전 시그니처는 `Promise<string | null>`이었고 null이 "비존재" 하나만 뜻했다.
   *    회원탈퇴 도입으로 의미가 둘로 갈렸는데 타입이 그대로면 호출자가 **조용히** 틀린다
   *    (`if (!authorId) throw 404` → 탈퇴 유저 글이 신고 불가). 그래서 반환 shape를 바꿔
   *    컴파일러가 잡게 했다 — 이름도 findAuthorId → findTargetMeta로 함께 바꾼 이유다.
   *
   * targetType이 'user'면 대상 자신이 작성자다 — 결함이 아니라 정의다
   * (report-target-type.ts doc). 이 분기의 authorId는 절대 null이 아니다: 탈퇴한 유저는
   * 행 자체가 없어 바깥 `null`(=404)로 간다.
   */
  async findTargetMeta(
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<{ authorId: string | null } | null> {
    switch (targetType) {
      case 'post': {
        const [row] = await this.db
          .select({ authorId: posts.authorId })
          .from(posts)
          .where(eq(posts.id, targetId));
        return row ?? null;
      }
      case 'comment': {
        // soft-deleted 제외 — 이미 삭제된 댓글은 신고 대상이 아니다(본문이 NULL로
        // 지워져 있어 심사할 것도 없다). 플레이스홀더만 남은 루트도 여기서 걸린다.
        const [row] = await this.db
          .select({ authorId: comments.authorId })
          .from(comments)
          .where(and(eq(comments.id, targetId), isNull(comments.deletedAt)));
        return row ?? null;
      }
      case 'user': {
        const [row] = await this.db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, targetId));
        return row ? { authorId: row.id } : null;
      }
    }
  }
}
