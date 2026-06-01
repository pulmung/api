import { uuidv7 } from 'uuidv7';
import type { SocialProvider } from '../../../database/schema/user.schema';
import { DomainError } from './errors';

interface CreateFromSocialInput {
  provider: SocialProvider;
  providerUserId: string;
  email: string | null;
  nickname: string;
}

interface PersistedUser {
  id: string;
  provider: SocialProvider;
  providerUserId: string;
  email: string | null;
  nickname: string;
}

/**
 * 유저 도메인 엔티티 (Aggregate Root).
 * setter 없음 — 생성 불변식은 팩토리에서만 통과한다.
 */
export class UserEntity {
  private constructor(
    readonly id: string,
    readonly provider: SocialProvider,
    readonly providerUserId: string,
    readonly email: string | null,
    readonly nickname: string,
  ) {}

  /**
   * 검증된 소셜 신원 + 유저 입력 nickname 으로 새 유저 생성.
   * id 는 INSERT 전에 앱이 확보(UUIDv7) — 스키마의 $defaultFn 은 안전망.
   */
  static createFromSocial(input: CreateFromSocialInput): UserEntity {
    const nickname = input.nickname.trim();
    if (nickname.length === 0) {
      throw new DomainError('nickname is required');
    }
    if (input.providerUserId.length === 0) {
      throw new DomainError('provider identity is required');
    }
    return new UserEntity(
      uuidv7(),
      input.provider,
      input.providerUserId,
      input.email,
      nickname,
    );
  }

  /** 저장소(DB)에서 읽은 행을 엔티티로 복원. */
  static fromPersistence(row: PersistedUser): UserEntity {
    return new UserEntity(
      row.id,
      row.provider,
      row.providerUserId,
      row.email,
      row.nickname,
    );
  }
}
