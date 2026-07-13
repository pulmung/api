import { Injectable } from '@nestjs/common';
import { validateNickname } from '../domain/user';
import { UserNotFoundError } from '../domain/user.error';
import { UserWriter } from '../repository/user.writer';

@Injectable()
export class UpdateUserUseCase {
  constructor(private readonly userWriter: UserWriter) {}

  async execute(command: { id: string; nickname?: string }): Promise<void> {
    // merge-patch: undefined = 미변경 — 제공된 필드만 도메인 불변식 검증.
    const nickname =
      command.nickname === undefined
        ? undefined
        : validateNickname(command.nickname);

    const updated = await this.userWriter.update(command.id, { nickname });
    // 무상태 JWT sub가 가리키는 행이 없을 수 있다 — GET /users/me와 동일한 404.
    if (!updated) throw new UserNotFoundError();
    // 커맨드라 반환 없음 — 응답 표현(조회 DTO)은 컨트롤러가 재조회로 만든다.
  }
}
