import type { SocialProvider } from '../../../database/schema/user.schema';
import { UserEntity } from './user';

/** 유저 영속화 포트(인터페이스). 구현은 infrastructure 어댑터. */
export interface UserRepository {
  findByProviderIdentity(
    provider: SocialProvider,
    providerUserId: string,
  ): Promise<UserEntity | null>;

  /**
   * 신규 유저 저장.
   * 유니크 위반 시 UserAlreadyExistsError / NicknameAlreadyTakenError 를 던진다.
   */
  save(user: UserEntity): Promise<UserEntity>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
