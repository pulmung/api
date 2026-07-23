import { Injectable } from '@nestjs/common';
import { CommentPatch } from '../domain/comment';
import { CommentNotFoundError } from '../domain/comment.error';
import { CommentWriter } from '../repository/comment.writer';

@Injectable()
export class UpdateCommentUseCase {
  constructor(private readonly commentWriter: CommentWriter) {}

  async execute(command: {
    id: string;
    authorId: string;
    content: string;
  }): Promise<void> {
    const patch = CommentPatch.create({ content: command.content });
    const updated = await this.commentWriter.update(
      command.id,
      command.authorId,
      patch,
    );
    // 비존재·타인 댓글·soft-deleted 수렴(존재 은닉) — delete-post와 동일 결.
    if (!updated) throw new CommentNotFoundError();
  }
}
