import { uuidv7 } from 'uuidv7';
import { SocialProvider } from './social-provider';
import { InvalidNicknameError } from './user.error';

// 불변식 한도 — DTO(Zod 경계)도 이 값을 import해 이중기재 drift를 막는다.
export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 20;

// User.register(가입)와 프로필 수정 patch 경로가 같은 불변식을 공유한다.
//
// patch 가능 필드가 둘(nickname·profileImageKey)로 늘었지만 여전히 `UserPlantPatch` 같은
// 값객체를 만들지 않는다 — 그 클래스가 사주는 건 "필드 간 관계 불변식을 한 곳에"인데
// 이 둘은 서로 무관하고 각자 독립 검증 함수로 끝난다. 유스케이스가 두 줄 더 쓰는 대신
// 클래스 하나를 안 만드는 쪽이 싸다(§0). 필드가 더 늘거나 **필드 간** 규칙이 생기면 그때.
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
