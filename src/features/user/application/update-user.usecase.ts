import { Injectable } from '@nestjs/common';
import { S3FileStorage } from '../../file/infrastructure/s3-file.storage';
import { validateNickname } from '../domain/user';
import { validateProfileImageKey } from '../domain/user-profile-image';
import {
  ProfileImageNotUploadedError,
  UserNotFoundError,
} from '../domain/user.error';
import { UserWriter } from '../repository/user.writer';

@Injectable()
export class UpdateUserUseCase {
  constructor(
    private readonly storage: S3FileStorage,
    private readonly userWriter: UserWriter,
  ) {}

  async execute(command: {
    id: string;
    nickname?: string;
    profileImageKey?: string | null;
  }): Promise<void> {
    // merge-patch 3분기: undefined = 미변경 / null = 해제 / 값 = 교체.
    // 제공된 필드만 도메인 불변식 검증 — null은 검증 대상이 아니라 해제 신호다.
    const nickname =
      command.nickname === undefined
        ? undefined
        : validateNickname(command.nickname);
    const profileImageKey =
      command.profileImageKey == null
        ? command.profileImageKey
        : validateProfileImageKey(command.profileImageKey);

    // 싼 불변식(prefix)을 먼저 통과시킨 뒤 S3 왕복 — update-user-plant.usecase와 같은 순서.
    // 첨부 시점 실존 검증(docs/file-upload.md §1) — presign만 받고 업로드 안 한 key 차단.
    // head는 NotFound→null, 권한 오류 등은 throw(→500)로 어댑터가 이미 갈라놨다.
    if (profileImageKey != null) {
      const head = await this.storage.head(profileImageKey);
      if (head === null) throw new ProfileImageNotUploadedError();
    }

    const updated = await this.userWriter.update(command.id, {
      nickname,
      profileImageKey,
    });
    // 무상태 JWT sub가 가리키는 행이 없을 수 있다 — GET /users/me와 동일한 404.
    if (!updated) throw new UserNotFoundError();
    // 커맨드라 반환 없음 — 응답 표현(조회 DTO)은 컨트롤러가 재조회로 만든다.
  }
}
