import { Injectable } from '@nestjs/common';
import { Comment } from '../domain/comment';
import {
  CommentNotFoundError,
  ReplyDepthExceededError,
} from '../domain/comment.error';
import { CommentReader } from '../repository/comment.reader';
import { CommentWriter } from '../repository/comment.writer';

@Injectable()
export class CreateReplyUseCase {
  constructor(
    private readonly commentReader: CommentReader,
    private readonly commentWriter: CommentWriter,
  ) {}

  async execute(command: {
    parentId: string;
    authorId: string;
    content: string;
    mentionedUserId?: string;
  }): Promise<{ id: string }> {
    // 부모 사전 분류 — 2계층 불변식·삭제 상태는 FK가 못 주는 진실이라 SELECT가 불가피.
    const parent = await this.commentReader.findParentMeta(command.parentId);
    // soft-deleted 플레이스홀더는 표적 연산에 소멸한 리소스 — 비존재와 같은 404.
    if (!parent || parent.deletedAt) throw new CommentNotFoundError();
    // 답글의 답글 금지(물리 2계층) — 같은 루트 밑 형제 답글 + 멘션으로 표현하라는 422.
    if (parent.parentId) throw new ReplyDepthExceededError();

    const reply = Comment.createReply({
      // 답글의 postId = 루트의 postId — 구성으로 보장(클라 입력이 아니다).
      postId: parent.postId,
      authorId: command.authorId,
      parentId: command.parentId,
      content: command.content,
      mentionedUserId: command.mentionedUserId,
    });
    // 사전 분류와 INSERT 사이의 race는 FK가 닫는다: 부모 하드 삭제 → 23503 → 404.
    // (soft delete와의 틈새는 수용 — "삭제 직전 도착"과 동치, 카운터 정합.)
    await this.commentWriter.create(reply);
    return { id: reply.id };
  }
}
