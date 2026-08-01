import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { PostNotFoundError } from '../domain/post.error';
import { PostLikeWriter } from '../repository/post-like.writer';
import { PostReader } from '../repository/post.reader';
import { PostWriter } from '../repository/post.writer';

/**
 * 좋아요 — 완전 멱등. 이미 좋아요한 글에 다시 와도 성공하고 카운터는 움직이지 않는다.
 *
 * `@Transactional()`이 이 메서드 전체를 하나의 트랜잭션으로 묶는다. 좋아요 행과
 * `posts.likeCount`는 함께여야만 참인 진실이므로 경계가 여기(유스케이스)에 있어야 한다 —
 * 어댑터가 각자 트랜잭션을 열면 둘을 묶을 방법이 없다. 전파는 CLS가 하므로 어댑터
 * 시그니처에 tx를 흘리지 않는다.
 */
@Injectable()
export class LikePostUseCase {
  constructor(
    private readonly postLikeWriter: PostLikeWriter,
    private readonly postWriter: PostWriter,
    private readonly postReader: PostReader,
  ) {}

  /** @returns 갱신된 likeCount (이미 좋아요 상태면 현재 값 그대로) */
  @Transactional()
  async execute(command: { postId: string; userId: string }): Promise<number> {
    // 글 실존 검증은 사전 SELECT가 아니라 FK 23503 → 404 (writer 번역, §7).
    const inserted = await this.postLikeWriter.insertIfAbsent(
      command.postId,
      command.userId,
    );

    if (inserted) {
      const likeCount = await this.postWriter.adjustLikeCount(
        command.postId,
        1,
      );
      // 방금 삽입한 좋아요의 FK가 글 행에 KEY SHARE를 걸고 있어 동시 삭제가 못 끼어든다
      // — 여기서 0행은 불변식 위반이므로 404가 아니라 500이 정직하다.
      if (likeCount === null) {
        throw new Error(
          `post vanished while counting likes: ${command.postId}`,
        );
      }
      return likeCount;
    }

    // 0행 = 이미 좋아요 — 카운터는 그대로 두고 현재 값만 읽어 응답을 멱등하게 만든다.
    // ⚠️ 이 조회는 0행일 수 있다. "INSERT가 통과했으니 글은 있다"가 이 분기엔 성립하지
    // 않는다 — FK 검사는 삽입된 행마다 도는 AFTER ROW 트리거라, ON CONFLICT가 삽입을
    // 억제하면 FK 검사 자체가 돌지 않는다. 게다가 DO NOTHING은 충돌한 기존 행에 잠금도
    // 걸지 않으므로(DO UPDATE와 다른 점) 그 사이 글이 삭제될 수 있다 → 사라진 글은 404.
    const likeCount = await this.postReader.findLikeCount(command.postId);
    if (likeCount === null) throw new PostNotFoundError();
    return likeCount;
  }
}
