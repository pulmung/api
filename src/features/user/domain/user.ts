import { uuidv7 } from 'uuidv7';
import { SocialProvider } from './social-provider';
import { InvalidNicknameError } from './user.error';

export class User {
  private constructor(
    readonly id: string,
    readonly provider: SocialProvider,
    readonly providerUserId: string,
    readonly email: string | null,
    readonly nickname: string,
  ) {}

  static register(params: {
    provider: SocialProvider;
    providerUserId: string;
    email: string | null;
    nickname: string;
  }): User {
    const nickname = params.nickname.trim();
    if (nickname.length < 2 || nickname.length > 20) {
      throw new InvalidNicknameError();
    }
    return new User(
      uuidv7(),
      params.provider,
      params.providerUserId,
      params.email,
      nickname,
    );
  }
}
