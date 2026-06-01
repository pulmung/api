import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { SocialProvider } from '../../../database/schema/user.schema';
import { Env } from '../../../config/env.validation';

/**
 * 자체 JWT 발급. 현재는 access 토큰만.
 * (refresh 토큰은 기기당 1개 + 회전 설계와 함께 추후 추가)
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** access 토큰 발급. sub 는 우리 user id(UUIDv7). */
  issueAccessToken(userId: string, provider: SocialProvider): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, provider, typ: 'access' },
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN', { infer: true }),
      },
    );
  }
}
