import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../../../common/auth/auth-user';
import { UnauthenticatedError } from '../domain/auth.error';

// @OptionalAuth 가 붙인 메타데이터 키. 가드가 "토큰 없으면 익명 통과" 모드를 판별한다.
export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();

    const isOptional = this.reflector.getAllAndOverride<boolean>(
      IS_OPTIONAL_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isOptional && !request.headers.authorization) return true;

    const token = this.extractToken(request);

    let payload: { sub?: unknown };
    try {
      payload = await this.jwt.verifyAsync<{ sub?: unknown }>(token, {
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthenticatedError();
    }

    if (typeof payload.sub !== 'string') {
      throw new UnauthenticatedError();
    }

    (request as AuthenticatedRequest).user = { id: payload.sub };
    return true;
  }

  private extractToken(request: Request) {
    const header = request.headers.authorization;
    if (!header) throw new UnauthenticatedError();

    const [schema, token] = header.split(' ');
    if (schema?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthenticatedError();
    }
    return token;
  }
}
