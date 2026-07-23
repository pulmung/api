import { Injectable } from '@nestjs/common';
import { CommentNotFoundError } from '../domain/comment.error';
import { CommentWriter } from '../repository/comment.writer';

@Injectable()
export class DeleteCommentUseCase {
  constructor(private readonly commentWriter: CommentWriter) {}

  async execute(command: { id: string; authorId: string }): Promise<void> {
    // 하드/soft 삼분기는 writer 몫(FK 판정) — usecase는 존재 은닉 404만 안다.
    const deleted = await this.commentWriter.delete(
      command.id,
      command.authorId,
    );
    if (!deleted) throw new CommentNotFoundError();
  }
}
