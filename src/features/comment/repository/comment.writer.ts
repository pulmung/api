import { Injectable, Logger } from '@nestjs/common';
import { DatabaseError } from 'pg';
import {
  and,
  DrizzleQueryError,
  eq,
  isNotNull,
  isNull,
  notExists,
  sql,
} from 'drizzle-orm';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { DrizzleDB } from '../../../database/drizzle.constants';
import type { DrizzleTransactionalAdapter } from '../../../database/drizzle-transactional.adapter';
import { PG_ERROR_CODE } from '../../../database/postgres-error';
import {
  comments,
  FK_COMMENTS_AUTHOR,
  FK_COMMENTS_MENTIONED_USER,
  FK_COMMENTS_PARENT,
  FK_COMMENTS_POST,
} from '../../../database/schema';
import { UnauthenticatedError } from '../../auth/domain/auth.error';
import { PostNotFoundError } from '../../post/domain/post.error';
import { Comment, CommentPatch } from '../domain/comment';
import {
  CommentNotFoundError,
  MentionedUserNotFoundError,
} from '../domain/comment.error';

/**
 * 하드 삭제가 "살아있는 답글" 때문에 거부됐다는 신호 — 삭제 삼분기의 판정자다.
 * pg의 23503/제약 이름은 어댑터 안에 가두고, 유스케이스엔 도메인 언어의 질문만 넘긴다.
 * DomainError가 **아니다**: HTTP로 나갈 일이 없는 내부 신호이고, 새어나간다면 그건 버그라
 * 500이 정직하다(도메인 예외였다면 이상한 상태코드로 응답돼 버그가 감춰진다).
 */
export class LiveRepliesPresentError extends Error {}

/**
 * 댓글 쓰기 어댑터 — `comments` **한 테이블만** 소유한다. `posts.commentCount`는 posts의
 * 컬럼이라 PostWriter가 쓰고, 둘을 원자적으로 묶는 책임은 유스케이스에 있다
 * (`@Transactional()`). 어댑터가 트랜잭션을 열지 않으므로 다른 어댑터와 조합 가능하다.
 */
@Injectable()
export class CommentWriter {
  private readonly logger = new Logger(CommentWriter.name);

  constructor(
    private readonly txHost: TransactionHost<DrizzleTransactionalAdapter>,
  ) {}

  // 진행 중인 트랜잭션이 있으면 그 핸들을, 없으면 평범한 db를 준다(CLS가 고른다) —
  // 덕분에 이 어댑터의 쿼리는 트랜잭션 안팎에서 같은 코드로 동작한다.
  private get db(): DrizzleDB {
    return this.txHost.tx;
  }

  // 루트·답글 공용 — 구조 차이(parentId·mentionedUserId)는 도메인 팩토리가 이미 결정했다.
  // 카운터 증감은 호출자(유스케이스)가 같은 트랜잭션에서 이어서 한다.
  async insert(comment: Comment): Promise<void> {
    try {
      await this.db.insert(comments).values({
        id: comment.id,
        postId: comment.postId,
        authorId: comment.authorId,
        parentId: comment.parentId,
        mentionedUserId: comment.mentionedUserId,
        content: comment.content,
      });
    } catch (e) {
      this.throwIfFkViolation(e);
      throw e;
    }
  }

  /** @returns false = 비존재·타인 댓글·soft-deleted (구분하지 않는다 — 존재 은닉) */
  async update(
    id: string,
    authorId: string,
    patch: CommentPatch,
  ): Promise<boolean> {
    // updatedAt은 $onUpdate가 붙인다 — 본문 수정은 진짜 수정이라 억제하지 않는다.
    const rows = await this.db
      .update(comments)
      .set({ content: patch.content })
      .where(this.ownedLive(id, authorId))
      .returning({ id: comments.id });
    return rows.length > 0;
  }

  /**
   * 하드 삭제 시도 — 판정은 사전 EXISTS가 아니라 FK가 한다(comment.schema.ts doc):
   * 살아있는 답글이 있는 루트면 fk_comments_parent(NO ACTION = 문장 끝 검사)가 23503을
   * 던지고, 이를 LiveRepliesPresentError로 번역해 호출자가 soft delete로 전환한다.
   * race-safe 무잠금 — EXISTS 검사와 DELETE 사이에 답글이 끼어들 틈이 없다.
   *
   * @returns null = 비존재·타인 댓글·이미 삭제됨 (존재 은닉)
   * @throws LiveRepliesPresentError 살아있는 답글이 있어 하드 삭제 불가
   */
  async deleteOwnedLive(
    id: string,
    authorId: string,
  ): Promise<{ postId: string; parentId: string | null } | null> {
    try {
      const [row] = await this.db
        .delete(comments)
        .where(this.ownedLive(id, authorId))
        .returning({ postId: comments.postId, parentId: comments.parentId });
      return row ?? null;
    } catch (e) {
      if (this.isFkViolation(e, FK_COMMENTS_PARENT)) {
        throw new LiveRepliesPresentError();
      }
      throw e;
    }
  }

  /**
   * 플레이스홀더 전환 — content NULL = 삭제 요청된 본문을 보관하지 않는다(개인정보 최소화 §11).
   * @returns null = 비존재·타인 댓글·이미 삭제됨
   */
  async softDeleteOwnedLive(
    id: string,
    authorId: string,
  ): Promise<{ postId: string } | null> {
    const [row] = await this.db
      .update(comments)
      .set({ deletedAt: new Date(), content: null })
      .where(this.ownedLive(id, authorId))
      .returning({ postId: comments.postId });
    return row ?? null;
  }

  /**
   * 마지막 답글이 지워진 soft-deleted 루트(답글 0인 플레이스홀더)를 하드 삭제 —
   * 본 삭제 커밋 후의 best-effort 정리라 실패해도 삼킨다(성공한 요청을 5xx로
   * 뒤집지 않는다 — "모르는 에러 rethrow" §7의 문서화된 예외). 카운터 무변동:
   * soft delete 시점에 이미 감소했다. tx 안에 넣지 말 것 — 동시 답글 INSERT의
   * KEY SHARE 락과 얽히면 본 삭제까지 롤백된다. (그래서 유스케이스도 이 호출만은
   * `@Transactional()` 메서드 **바깥**에서 한다.)
   */
  async cleanupOrphanPlaceholder(parentId: string): Promise<void> {
    try {
      await this.db.delete(comments).where(
        and(
          eq(comments.id, parentId),
          isNotNull(comments.deletedAt),
          // 가드가 일상 경로(부모 생존·다른 답글 잔존)를 0행 no-op으로 거른다.
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(comments)
              .where(eq(comments.parentId, parentId)),
          ),
        ),
      );
    } catch (e) {
      // 가드와 DELETE 사이에 새 답글이 착지한 race — 정리 취소가 정답이라 무음.
      if (this.isFkViolation(e, FK_COMMENTS_PARENT)) return;
      this.logger.warn(
        { err: e, parentId },
        'orphan placeholder cleanup failed',
      );
    }
  }

  // 소유 + 살아있음 스코프 — 쓰기 계열 공통 WHERE. soft-deleted는 표적 연산에
  // 소멸한 리소스라(도메인 에러 doc) deleted_at IS NULL이 authorId와 함께 간다.
  private ownedLive(id: string, authorId: string) {
    return and(
      eq(comments.id, id),
      eq(comments.authorId, authorId),
      isNull(comments.deletedAt),
    );
  }

  private isFkViolation(e: unknown, constraint: string): boolean {
    const cause = e instanceof DrizzleQueryError ? e.cause : e;
    return (
      cause instanceof DatabaseError &&
      cause.code === PG_ERROR_CODE.FOREIGN_KEY_VIOLATION &&
      cause.constraint === constraint
    );
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
    if (cause.constraint === FK_COMMENTS_POST) {
      throw new PostNotFoundError();
    }
    // 부모 루트가 사전 조회와 INSERT 사이에 하드 삭제된 race — 404.
    if (cause.constraint === FK_COMMENTS_PARENT) {
      throw new CommentNotFoundError();
    }
    // body의 mentionedUserId가 비존재(탈퇴) 유저 — 422.
    if (cause.constraint === FK_COMMENTS_MENTIONED_USER) {
      throw new MentionedUserNotFoundError();
    }
    // 탈퇴 직후 아직 만료 안 된 access token의 INSERT(post.writer와 동일 결) — 401.
    if (cause.constraint === FK_COMMENTS_AUTHOR) {
      throw new UnauthenticatedError();
    }
  }
}
