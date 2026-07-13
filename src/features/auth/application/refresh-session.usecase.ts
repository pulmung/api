import { Injectable, Logger } from '@nestjs/common';
import { SessionReader } from '../repository/session.reader';
import { SessionWriter } from '../repository/session.writer';
import { SessionIssuer } from './session.issuer';
import { hashSecret, parseRefreshToken } from '../infrastructure/refresh-token';
import { InvalidRefreshTokenError } from '../domain/auth.error';

// 회전 직후 직전 토큰을 허용하는 창 — 멀티탭 동시 refresh 레이스 완화 (docs/api-gaps.md 3)
export const REFRESH_REUSE_GRACE_MS = 10_000;

@Injectable()
export class RefreshSessionUseCase {
  private readonly logger = new Logger(RefreshSessionUseCase.name);

  constructor(
    private readonly sessionReader: SessionReader,
    private readonly sessionWriter: SessionWriter,
    private readonly sessionIssuer: SessionIssuer,
  ) {}

  async execute(command: { refreshToken: string }) {
    const parsed = parseRefreshToken(command.refreshToken);
    if (!parsed) throw new InvalidRefreshTokenError();

    const session = await this.sessionReader.findById(parsed.sessionId);
    if (!session) throw new InvalidRefreshTokenError();

    if (session.expiresAt < new Date()) {
      await this.sessionWriter.revoke(parsed.sessionId);
      throw new InvalidRefreshTokenError();
    }

    const presentedHash = hashSecret(parsed.secret);

    if (presentedHash === session.tokenHash) {
      return this.sessionIssuer.rotate(
        parsed.sessionId,
        session.userId,
        session.tokenHash,
      );
    }

    // 직전 토큰 + grace 내 = 멀티탭 동시 refresh 레이스로 간주하고 허용
    if (
      session.prevTokenHash !== null &&
      presentedHash === session.prevTokenHash &&
      session.rotatedAt !== null &&
      Date.now() - session.rotatedAt.getTime() <= REFRESH_REUSE_GRACE_MS
    ) {
      this.logger.log(
        `Refresh reuse within grace window - session=${parsed.sessionId}, user=${session.userId}`,
      );
      return this.sessionIssuer.graceRotate(parsed.sessionId, session.userId);
    }

    this.logger.warn(
      `Refresh token reuse detected - session=${parsed.sessionId}, user=${session.userId}`,
    );
    await this.sessionWriter.revoke(parsed.sessionId);
    throw new InvalidRefreshTokenError();
  }
}
