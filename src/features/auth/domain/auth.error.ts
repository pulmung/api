import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';

export class InvalidSocialTokenError extends DomainError {
  readonly code = 'INVALID_SOCIAL_TOKEN';
  readonly status = HttpStatus.UNAUTHORIZED;
}

export class InvalidRefreshTokenError extends DomainError {
  readonly code = 'INVALID_REFRESH_TOKEN';
  readonly status = HttpStatus.UNAUTHORIZED;
}

export class UnauthenticatedError extends DomainError {
  readonly code = 'UNAUTHENTICATED';
  readonly status = HttpStatus.UNAUTHORIZED;
}
