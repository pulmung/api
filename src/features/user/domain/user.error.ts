import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';

export class InvalidNicknameError extends DomainError {
  readonly code = 'INVALID_NICKNAME';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

// 자기 purpose 네임스페이스가 아닌 key — 형식 규칙은 도메인 소유라 400(Zod)이 아니라 422다
// (user-plant/plant 이미지와 동일한 갈림).
export class InvalidProfileImageError extends DomainError {
  readonly code = 'INVALID_PROFILE_IMAGE';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

// presign만 받고 실제 업로드는 안 한 key — 첨부 시점 head() 실존 검증 실패.
export class ProfileImageNotUploadedError extends DomainError {
  readonly code = 'PROFILE_IMAGE_NOT_UPLOADED';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

export class NicknameTakenError extends DomainError {
  readonly code = 'NICKNAME_TAKEN';
  readonly status = HttpStatus.CONFLICT;
}

export class UserAlreadyRegisteredError extends DomainError {
  readonly code = 'USER_ALREADY_REGISTERED';
  readonly status = HttpStatus.CONFLICT;
}

export class UserNotFoundError extends DomainError {
  readonly code = 'USER_NOT_FOUND';
  readonly status = HttpStatus.NOT_FOUND;
}
