import { Injectable } from '@nestjs/common';
import { User } from '../../user/domain/user';
import { UserWriter } from '../../user/repository/user.writer';
import { SocialProvider } from '../../user/domain/social-provider';
import { SocialIdentityVerifier } from '../infrastructure/social/identity.verifier';
import { JwtTokenIssuer } from '../infrastructure/jwt-token.issuer';

@Injectable()
export class SignupUserUseCase {
  constructor(
    private readonly verifier: SocialIdentityVerifier,
    private readonly userWriter: UserWriter,
    private readonly tokenIssuer: JwtTokenIssuer,
  ) {}

  async execute(command: {
    provider: SocialProvider;
    accessToken: string;
    nickname: string;
  }) {
    const identity = await this.verifier.verify({
      provider: command.provider,
      accessToken: command.accessToken,
    });

    const user = User.register({
      provider: identity.provider,
      providerUserId: identity.providerUserId,
      email: identity.email,
      nickname: command.nickname,
    });

    await this.userWriter.create(user);
    return { accessToken: this.tokenIssuer.issue(user) };
  }
}
