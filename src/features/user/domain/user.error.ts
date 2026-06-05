import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';

export class InvalidNicknameError extends DomainError {
  readonly code = 'INVALID_NICKNAME';
  readonly status: HttpStatus.UNPROCESSABLE_ENTITY;
}

export class NicknameTakenError extends DomainError {
  readonly code = 'NICKNAME_TAKEN';
  readonly status = HttpStatus.CONFLICT;
}

export class UserAlreadyRegisteredError extends DomainError {
  readonly code = 'USER_ALREADY_REGISTERED';
  readonly status = HttpStatus.CONFLICT;
}
