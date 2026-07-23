import { Injectable } from '@nestjs/common';
import { Comment } from '../domain/comment';
import { CommentWriter } from '../repository/comment.writer';

@Injectable()
export class CreateCommentUseCase {
  constructor(private readonly commentWriter: CommentWriter) {}

  async execute(command: {
    postId: string;
    authorId: string;
    content: string;
  }): Promise<{ id: string }> {
    const comment = Comment.createRoot(command);
    // 글 실존 검증은 사전 SELECT가 아니라 FK 23503 → 404 (writer 번역, §7).
    await this.commentWriter.create(comment);
    return { id: comment.id };
  }
}
