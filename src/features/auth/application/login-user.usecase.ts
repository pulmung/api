import { Injectable } from '@nestjs/common';
import { SocialIdentityVerifier } from '../infrastructure/social/identity.verifier';
import { UserReader } from '../../user/repository/user.reader';
import { DeviceContext, SessionIssuer } from './session.issuer';
import { SocialProvider } from '../../user/domain/social-provider';
import { UserNotFoundError } from '../../user/domain/user.error';

@Injectable()
export class LoginUserUseCase {
  constructor(
    private readonly verifier: SocialIdentityVerifier,
    private readonly userReader: UserReader,
    private readonly sessionIssuer: SessionIssuer,
  ) {}

  async execute(command: {
    provider: SocialProvider;
    accessToken: string;
    device: DeviceContext;
  }) {
    const identity = await this.verifier.verify({
      provider: command.provider,
      accessToken: command.accessToken,
    });

    const user = await this.userReader.findByProviderUserId(
      identity.provider,
      identity.providerUserId,
    );
    if (!user) throw new UserNotFoundError();

    return this.sessionIssuer.issue(user.id, command.device);
  }
}
