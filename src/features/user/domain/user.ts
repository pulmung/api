import { uuidv7 } from 'uuidv7';
import { SocialProvider } from './social-provider';
import { InvalidNicknameError } from './user.error';

// 불변식 한도 — DTO(Zod 경계)도 이 값을 import해 이중기재 drift를 막는다.
export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 20;

// User.register(가입)와 프로필 수정 patch 경로가 같은 불변식을 공유한다.
// patch 가능 필드가 nickname 하나뿐이라 값객체 대신 함수 export.
export function validateNickname(raw: string): string {
  const nickname = raw.trim();
  if (
    nickname.length < NICKNAME_MIN_LENGTH ||
    nickname.length > NICKNAME_MAX_LENGTH
  ) {
    throw new InvalidNicknameError();
  }
  return nickname;
}

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
    return new User(
      uuidv7(),
      params.provider,
      params.providerUserId,
      params.email,
      validateNickname(params.nickname),
    );
  }
}
