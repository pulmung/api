import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
import { PG_ERROR_CODE } from '../../../database/postgres-error';
import {
  comments,
  posts,
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

// db.transaction 콜백이 받는 트랜잭션 핸들 타입 — 카운터 증감을 같은 tx에 태우기 위함.
type DrizzleTx = Parameters<Parameters<DrizzleDB['transaction']>[0]>[0];

/**
 * 댓글 쓰기 어댑터 — repository 레이어 최초의 db.transaction 사용처(기존 전례는 seed뿐).
 * 댓글 행과 posts.commentCount는 함께여야만 참인 진실이라(비정규화 §스키마 doc),
 * 영속 원자성은 writer가 소유한다 — usecase는 여전히 boolean→404 형태만 본다.
 */
@Injectable()
export class CommentWriter {
  private readonly logger = new Logger(CommentWriter.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // 루트·답글 공용 — 구조 차이(parentId·mentionedUserId)는 도메인 팩토리가 이미 결정했다.
  async create(comment: Comment): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        // INSERT 먼저, 카운터는 뒤에 — FK 위반이 카운터를 건드리기 전에 터진다.
        await tx.insert(comments).values({
          id: comment.id,
          postId: comment.postId,
          authorId: comment.authorId,
          parentId: comment.parentId,
          mentionedUserId: comment.mentionedUserId,
          content: comment.content,
        });
        await this.adjustCommentCount(tx, comment.postId, 1);
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
   * 삭제 삼분기 — 판정은 사전 EXISTS가 아니라 FK가 한다(comment.schema.ts doc):
   * 하드 DELETE를 먼저 시도하고, 살아있는 답글이 있는 루트면 fk_comments_parent
   * (NO ACTION = 문장 끝 검사)가 23503으로 tx를 굴려 → soft delete로 전환한다.
   * race-safe 무잠금 — EXISTS 검사와 DELETE 사이에 답글이 끼어들 틈이 없다.
   * @returns false = 비존재·타인 댓글·이미 삭제됨 (존재 은닉)
   */
  async delete(id: string, authorId: string): Promise<boolean> {
    let deleted: { postId: string; parentId: string | null } | undefined;
    try {
      deleted = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .delete(comments)
          .where(this.ownedLive(id, authorId))
          .returning({ postId: comments.postId, parentId: comments.parentId });
        if (row) await this.adjustCommentCount(tx, row.postId, -1);
        return row;
      });
    } catch (e) {
      if (!this.isFkViolation(e, FK_COMMENTS_PARENT)) throw e;
      // 답글 있는 루트 — 플레이스홀더로 전환. content NULL = 삭제 요청된 본문을
      // 보관하지 않는다(개인정보 최소화 §11).
      return this.softDelete(id, authorId);
    }
    if (!deleted) return false;
    // 답글을 지웠고 부모가 고아 플레이스홀더(soft-deleted + 남은 답글 0)가 됐으면 정리.
    if (deleted.parentId) await this.cleanupOrphanPlaceholder(deleted.parentId);
    return true;
  }

  private async softDelete(id: string, authorId: string): Promise<boolean> {
    const row = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(comments)
        .set({ deletedAt: new Date(), content: null })
        .where(this.ownedLive(id, authorId))
        .returning({ postId: comments.postId });
      // 카운터 = 살아있는 댓글 수 — soft delete도 감소한다(플레이스홀더는 셈 밖).
      if (updated) await this.adjustCommentCount(tx, updated.postId, -1);
      return updated;
    });
    return row !== undefined;
  }

  /**
   * 마지막 답글이 지워진 soft-deleted 루트(답글 0인 플레이스홀더)를 하드 삭제 —
   * 본 삭제 커밋 후의 best-effort 정리라 실패해도 삼킨다(성공한 요청을 5xx로
   * 뒤집지 않는다 — "모르는 에러 rethrow" §7의 문서화된 예외). 카운터 무변동:
   * soft delete 시점에 이미 감소했다. tx 안에 넣지 말 것 — 동시 답글 INSERT의
   * KEY SHARE 락과 얽히면 본 삭제까지 롤백된다.
   */
  private async cleanupOrphanPlaceholder(parentId: string): Promise<void> {
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

  // 비정규화 카운터 증감 — updatedAt 자기대입으로 $onUpdate를 억제한다
  // (drizzle은 set에 값이 있으면 onUpdateFn을 안 태운다 — 댓글 활동 ≠ 글 수정).
  private async adjustCommentCount(
    tx: DrizzleTx,
    postId: string,
    delta: 1 | -1,
  ): Promise<void> {
    await tx
      .update(posts)
      .set({
        commentCount: sql`${posts.commentCount} + ${delta}`,
        updatedAt: sql`${posts.updatedAt}`,
      })
      .where(eq(posts.id, postId));
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
