import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { PostNotFoundError } from '../domain/post.error';
import { PostLikeWriter } from '../repository/post-like.writer';
import { PostReader } from '../repository/post.reader';
import { PostWriter } from '../repository/post.writer';

/** 좋아요 취소 — like와 대칭인 완전 멱등. 경계·전파 근거는 LikePostUseCase doc 참조. */
@Injectable()
export class UnlikePostUseCase {
  constructor(
    private readonly postLikeWriter: PostLikeWriter,
    private readonly postWriter: PostWriter,
    private readonly postReader: PostReader,
  ) {}

  /** @returns 갱신된 likeCount (좋아요가 없었으면 현재 값 그대로) */
  @Transactional()
  async execute(command: { postId: string; userId: string }): Promise<number> {
    const deleted = await this.postLikeWriter.delete(
      command.postId,
      command.userId,
    );

    if (deleted) {
      const likeCount = await this.postWriter.adjustLikeCount(
        command.postId,
        -1,
      );
      // 방금 지운 좋아요 행을 우리가 잡고 있어 글 삭제 cascade가 먼저 커밋될 수 없다
      // (그 경합은 교착으로 드러나지 0행으로 새지 않는다) — 0행은 불변식 위반.
      if (likeCount === null) {
        throw new Error(`post vanished while counting likes: ${command.postId}`);
      }
      return likeCount;
    }

    // 0행 = "좋아요가 없었다"와 "글이 없다"가 겹친다(DELETE는 FK를 태우지 않아 like처럼
    // 23503으로 갈리지 않는다) — 그때만 존재 확인. 좋아요 부재는 성공(멱등)이지만
    // 글 부재는 404다: 라우트 대상(URL)의 부재이므로.
    const likeCount = await this.postReader.findLikeCount(command.postId);
    if (likeCount === null) throw new PostNotFoundError();
    return likeCount;
  }
}
