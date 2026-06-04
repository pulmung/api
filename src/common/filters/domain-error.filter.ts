import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import {
  InvalidNicknameError,
  NicknameTakenError,
  UserAlreadyRegisteredError,
  UserDomainError,
} from '../../features/user/domain/user.error';
import {
  AuthDomainError,
  InvalidSocialTokenError,
} from '../../features/auth/domain/auth.error';
import { Response } from 'express';

@Catch(UserDomainError, AuthDomainError)
export class DomainErrorFilter implements ExceptionFilter {
  catch(error: Error, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status = this.toStatus(error);
    res.status(status).json({ statusCode: status, message: error.message });
  }

  private toStatus(error: Error) {
    if (error instanceof InvalidSocialTokenError) return 401;
    if (error instanceof NicknameTakenError) return 409;
    if (error instanceof UserAlreadyRegisteredError) return 409;
    if (error instanceof InvalidNicknameError) return 422;
    return 500;
  }
}
