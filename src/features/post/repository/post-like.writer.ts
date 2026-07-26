import { Injectable } from '@nestjs/common';
import { DatabaseError } from 'pg';
import { and, DrizzleQueryError, eq } from 'drizzle-orm';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { DrizzleDB } from '../../../database/drizzle.constants';
import type { DrizzleTransactionalAdapter } from '../../../database/drizzle-transactional.adapter';
import { PG_ERROR_CODE } from '../../../database/postgres-error';
import {
  postLikes,
  FK_POST_LIKES_POST,
  FK_POST_LIKES_USER,
} from '../../../database/schema';
import { UnauthenticatedError } from '../../auth/domain/auth.error';
import { PostNotFoundError } from '../domain/post.error';

/**
 * 좋아요 쓰기 어댑터 — `post_likes` **한 테이블만** 소유한다. 카운터(`posts.likeCount`)는
 * posts의 컬럼이므로 PostWriter가 쓰고, 둘을 원자적으로 묶는 책임은 유스케이스에 있다
 * (`@Transactional()`). 어댑터가 트랜잭션을 열지 않으므로 다른 어댑터와 자유롭게 조합된다.
 *
 * 두 연산 모두 "실제로 바뀐 행이 있었는가"를 boolean으로 돌려준다 — 멱등 판정의 근거가
 * 앱 조건문이 아니라 DB다. 중복은 복합 PK(pk_post_likes)가, 존재 판정은 영향받은 행 수가
 * 준다. 사전 SELECT("이미 눌렀나?")를 두지 않는 이유: 검사와 쓰기 사이에 경합이 생기고
 * (더블탭이 정확히 그 경합이다) 쿼리가 늘어난다 — §7 원칙.
 */
@Injectable()
export class PostLikeWriter {
  constructor(
    private readonly txHost: TransactionHost<DrizzleTransactionalAdapter>,
  ) {}

  // 진행 중인 트랜잭션이 있으면 그 핸들을, 없으면 평범한 db를 준다(CLS가 고른다) —
  // 덕분에 이 어댑터의 쿼리는 트랜잭션 안팎에서 같은 코드로 동작한다.
  private get db(): DrizzleDB {
    return this.txHost.tx;
  }

  /** @returns true = 이번에 새로 삽입됨 / false = 이미 좋아요 상태(멱등) */
  async insertIfAbsent(postId: string, userId: string): Promise<boolean> {
    try {
      const inserted = await this.db
        .insert(postLikes)
        .values({ postId, userId })
        .onConflictDoNothing({ target: [postLikes.postId, postLikes.userId] })
        .returning({ postId: postLikes.postId });
      return inserted.length > 0;
    } catch (e) {
      this.throwIfFkViolation(e);
      throw e;
    }
  }

  /**
   * @returns true = 이번에 실제로 지워짐 / false = 좋아요가 없었음(멱등)
   *
   * insertIfAbsent와 달리 FK 변환이 없다 — 의도된 비대칭이다. 자식 행 DELETE는 RI 검사를
   * 태우지 않아 23503이 발생할 경로가 없다. 대신 "글이 없다"와 "좋아요가 없었다"를 여기서
   * 구분할 수 없으므로(둘 다 0행) 그 판정은 카운터 갱신 결과로 호출자가 한다.
   */
  async delete(postId: string, userId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(postLikes)
      .where(and(eq(postLikes.postId, postId), eq(postLikes.userId, userId)))
      .returning({ postId: postLikes.postId });
    return deleted.length > 0;
  }

  // FK 위반(23503)을 도메인 예외로 변환 — 사전 SELECT 없음(post.writer와 같은 경로).
  private throwIfFkViolation(e: unknown): void {
    const cause = e instanceof DrizzleQueryError ? e.cause : e;
    if (
      !(cause instanceof DatabaseError) ||
      cause.code !== PG_ERROR_CODE.FOREIGN_KEY_VIOLATION
    ) {
      return; // 매치 안 되면 조용히 반환(호출부가 rethrow).
    }
    // 라우트 대상 글이 그 사이 삭제됨 — 404.
    if (cause.constraint === FK_POST_LIKES_POST) {
      throw new PostNotFoundError();
    }
    // 탈퇴 직후 아직 만료 안 된 access token의 INSERT(무상태 검증이라 즉시 모름 — §10) — 401.
    if (cause.constraint === FK_POST_LIKES_USER) {
      throw new UnauthenticatedError();
    }
  }
}
