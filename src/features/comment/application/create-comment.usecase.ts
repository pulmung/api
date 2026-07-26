import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { PostWriter } from '../../post/repository/post.writer';
import { Comment } from '../domain/comment';
import { CommentWriter } from '../repository/comment.writer';

@Injectable()
export class CreateCommentUseCase {
  constructor(
    private readonly commentWriter: CommentWriter,
    private readonly postWriter: PostWriter,
  ) {}

  // 댓글 행과 posts.commentCount는 함께여야만 참인 진실이라 한 트랜잭션에 묶는다.
  @Transactional()
  async execute(command: {
    postId: string;
    authorId: string;
    content: string;
  }): Promise<{ id: string }> {
    const comment = Comment.createRoot(command);
    // 글 실존 검증은 사전 SELECT가 아니라 FK 23503 → 404 (writer 번역, §7).
    // INSERT 먼저, 카운터는 뒤에 — FK 위반이 카운터를 건드리기 전에 터진다.
    await this.commentWriter.insert(comment);
    await this.postWriter.adjustCommentCount(comment.postId, 1);
    return { id: comment.id };
  }
}
