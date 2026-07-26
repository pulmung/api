import { Injectable } from '@nestjs/common';
import { UserBlockWriter } from '../repository/user-block.writer';

/**
 * 차단 해제 — 완전 멱등. 차단하지 않은 상대에 보내도 성공한다.
 *
 * **BlockUserUseCase와 달리 self 검사를 하지 않는다** — 의도된 비대칭이다.
 * DELETE의 사후 상태는 "차단 아님"이고, 자기 자신은 애초에 차단될 수 없으므로 이미 그
 * 상태다. 즉 요청은 아무것도 위반하지 않고 목표 상태에 이미 도달해 있다 → 422로 거부하면
 * "멱등 = 클라 분기 0"을 깨면서 얻는 게 없다. 존재하지 않는 유저 id에 대한 해제도 같은
 * 이유로 0행 성공으로 흡수한다(writer doc 참조).
 *
 * `@Transactional()` 없음 — BlockUserUseCase와 같은 이유(단일 문장, 카운터 없음).
 */
@Injectable()
export class UnblockUserUseCase {
  constructor(private readonly writer: UserBlockWriter) {}

  async execute(command: {
    blockerId: string;
    blockedId: string;
  }): Promise<void> {
    await this.writer.delete(command.blockerId, command.blockedId);
  }
}
