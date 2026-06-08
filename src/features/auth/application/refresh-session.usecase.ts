import { Injectable, Logger } from '@nestjs/common';
import { SessionReader } from '../repository/session.reader';
import { SessionWriter } from '../repository/session.writer';
import { SessionIssuer } from './session.issuer';
import { hashSecret, parseRefreshToken } from '../infrastructure/refresh-token';
import { InvalidRefreshTokenError } from '../domain/auth.error';

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

    if (hashSecret(parsed.secret) !== session.tokenHash) {
      this.logger.warn(
        `Refresh token reuse detected - session=${parsed.sessionId}, user=${session.userId}`,
      );
      await this.sessionWriter.revoke(parsed.sessionId);
      throw new InvalidRefreshTokenError();
    }

    return this.sessionIssuer.rotate(parsed.sessionId, session.userId);
  }
}
