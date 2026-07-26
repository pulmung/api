import { Injectable } from '@nestjs/common';
import { UserBlockWriter } from '../repository/user-block.writer';
import { SelfBlockError } from '../domain/moderation.error';

/**
 * 유저 차단 — 완전 멱등. 이미 차단한 상대에 다시 와도 성공한다(LikePostUseCase와 같은 결).
 *
 * `@Transactional()`이 없다 — 쓰기가 `user_blocks` 한 문장뿐이고 "함께 성공하거나 함께
 * 실패한다"는 비즈니스 진술이 없다(§7-1: 경계는 그 진술이 있을 때만 둔다). 좋아요가
 * 트랜잭션을 여는 건 카운터(`posts.likeCount`)와 원자적이어야 하기 때문인데, 차단엔
 * 비정규화 카운터가 없다. 미래에 "차단 시 알림 억제 상태도 함께 기록" 같은 요구가
 * 생기면 그때 이 메서드에 붙인다.
 *
 * UnblockUserUseCase와 의존이 같지만(§2는 "의존 응집도가 기준"이라 한 클래스로 묶어도
 * 된다고 한다) 나누어 둔다 — 두 연산의 **의미론이 갈리기** 때문이다: 자기 자신을 상대로
 * 했을 때 차단은 거부하고 해제는 흡수한다(각 파일 doc 참조). 그 차이가 문서화될 자리를 준다.
 */
@Injectable()
export class BlockUserUseCase {
  constructor(private readonly writer: UserBlockWriter) {}

  async execute(command: {
    blockerId: string;
    blockedId: string;
  }): Promise<void> {
    // 자기 차단 금지 — race가 없는 불변식이라 DB CHECK 없이 여기서 막는다
    // (두 값 모두 요청 자체에서 오고 동시성이 개입할 여지가 없다).
    if (command.blockerId === command.blockedId) throw new SelfBlockError();

    // 상대 실존 검증은 사전 SELECT가 아니라 FK 23503 → 404 (writer가 번역, §7).
    // 반환된 boolean(신규/기존)은 쓰지 않는다 — 응답이 상태를 말할 뿐 전이를 말하지
    // 않으므로(멱등) 클라가 분기할 값이 아니다.
    await this.writer.insertIfAbsent(command.blockerId, command.blockedId);
  }
}
