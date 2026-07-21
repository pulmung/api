import { Injectable } from '@nestjs/common';
import { PostNotFoundError } from '../domain/post.error';
import { PostWriter } from '../repository/post.writer';

@Injectable()
export class DeletePostUseCase {
  constructor(private readonly postWriter: PostWriter) {}

  async execute(command: { id: string; authorId: string }): Promise<void> {
    const deleted = await this.postWriter.delete(command.id, command.authorId);
    // 비존재·타인 글 수렴(존재 은닉) — GET :id와 동일한 404.
    if (!deleted) throw new PostNotFoundError();
  }
}
