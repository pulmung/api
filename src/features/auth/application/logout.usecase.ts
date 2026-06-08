import { Injectable } from '@nestjs/common';
import { SessionWriter } from '../repository/session.writer';
import { parseRefreshToken } from '../infrastructure/refresh-token';

@Injectable()
export class LogoutUseCase {
  constructor(private readonly sessionWriter: SessionWriter) {}

  async execute(command: { refreshToken: string }) {
    const parsed = parseRefreshToken(command.refreshToken);
    if (!parsed) return;
    await this.sessionWriter.revoke(parsed.sessionId);
  }
}
