import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { PostWriter } from '../../post/repository/post.writer';
import { CommentNotFoundError } from '../domain/comment.error';
import {
  CommentWriter,
  LiveRepliesPresentError,
} from '../repository/comment.writer';

/**
 * 댓글 삭제 삼분기 — 답글 없는 루트·답글은 하드 삭제, 답글이 남은 루트는 플레이스홀더로
 * 전환(soft delete). 판정은 사전 EXISTS가 아니라 FK가 한다(comment.schema.ts doc).
 *
 * ⚠️ 이 메서드에 `@Transactional()`을 붙이면 **안 된다.** 하드 삭제가 FK 23503으로 실패하면
 * 그 트랜잭션은 이미 abort 상태라 같은 트랜잭션에서 soft delete를 이어갈 수 없다(후속 문장이
 * "current transaction is aborted"로 거부된다). 그래서 경계를 아래 private 메서드 두 개로
 * 내려 **각각 독립 트랜잭션**을 갖게 하고, 분기(catch)는 트랜잭션 밖에서 한다.
 * 고아 플레이스홀더 정리도 본 삭제가 커밋된 뒤여야 하므로 바깥에 남는다.
 */
@Injectable()
export class DeleteCommentUseCase {
  constructor(
    private readonly commentWriter: CommentWriter,
    private readonly postWriter: PostWriter,
  ) {}

  async execute(command: { id: string; authorId: string }): Promise<void> {
    let deleted: { postId: string; parentId: string | null } | null;
    try {
      deleted = await this.hardDelete(command.id, command.authorId);
    } catch (e) {
      if (!(e instanceof LiveRepliesPresentError)) throw e;
      // 답글 있는 루트 — 새 트랜잭션에서 플레이스홀더로 전환한다.
      const softDeleted = await this.softDelete(command.id, command.authorId);
      // 그 사이 남이 지웠다면 비존재와 같은 404(존재 은닉).
      if (!softDeleted) throw new CommentNotFoundError();
      return;
    }

    // 비존재·타인 댓글·이미 삭제됨 수렴(존재 은닉) — delete-post와 동일 결.
    if (!deleted) throw new CommentNotFoundError();

    // 답글을 지웠고 부모가 고아 플레이스홀더(soft-deleted + 남은 답글 0)가 됐으면 정리.
    // best-effort이며 반드시 본 삭제 커밋 **후**여야 한다(writer doc의 락 주의).
    if (deleted.parentId) {
      await this.commentWriter.cleanupOrphanPlaceholder(deleted.parentId);
    }
  }

  /** @throws LiveRepliesPresentError 살아있는 답글이 있어 하드 삭제 불가 → 호출자가 전환 */
  @Transactional()
  private async hardDelete(
    id: string,
    authorId: string,
  ): Promise<{ postId: string; parentId: string | null } | null> {
    const deleted = await this.commentWriter.deleteOwnedLive(id, authorId);
    if (deleted) await this.postWriter.adjustCommentCount(deleted.postId, -1);
    return deleted;
  }

  @Transactional()
  private async softDelete(id: string, authorId: string): Promise<boolean> {
    const updated = await this.commentWriter.softDeleteOwnedLive(id, authorId);
    // 카운터 = 살아있는 댓글 수 — soft delete도 감소한다(플레이스홀더는 셈 밖).
    if (updated) await this.postWriter.adjustCommentCount(updated.postId, -1);
    return updated !== null;
  }
}
