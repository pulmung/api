import { Injectable } from '@nestjs/common';
import { JwtTokenIssuer } from '../infrastructure/jwt-token.issuer';
import { SessionWriter } from '../repository/session.writer';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../../config/env.validation';
import { ClientPlatform } from '../domain/client-platform';
import {
  createRefreshToken,
  rotateRefreshToken,
} from '../infrastructure/refresh-token';

export interface DeviceContext {
  platform: ClientPlatform;
  deviceName: string | null;
  userAgent: string | null;
  ip: string | null;
}

@Injectable()
export class SessionIssuer {
  constructor(
    private readonly jwtIssuer: JwtTokenIssuer,
    private readonly sessionWriter: SessionWriter,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async issue(userId: string, device: DeviceContext) {
    const { sessionId, token, tokenHash } = createRefreshToken();

    await this.sessionWriter.create({
      id: sessionId,
      userId,
      tokenHash,
      ...device,
      expiresAt: this.refreshExpiry(),
    });

    return {
      accessToken: this.jwtIssuer.issue(userId),
      refreshToken: token,
    };
  }

  private refreshExpiry() {
    const days = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
    return new Date(Date.now() + days * 86_400_000);
  }

  async rotate(sessionId: string, userId: string) {
    const { token, tokenHash } = rotateRefreshToken(sessionId);
    await this.sessionWriter.rotate(sessionId, tokenHash);
    return { accessToken: this.jwtIssuer.issue(userId), refreshToken: token };
  }
}
