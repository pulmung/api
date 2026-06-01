import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { SocialProvider } from '../../../database/schema/user.schema';
import {
  NicknameAlreadyTakenError,
  UserAlreadyExistsError,
} from '../domain/errors';
import { UserEntity } from '../domain/user';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../domain/user.repository';
import { SocialVerifierRegistry } from './social-verifier.registry';
import { TokenService } from './token.service';

export interface SignupCommand {
  provider: SocialProvider;
  accessToken: string;
  nickname: string;
}

export interface SignupResult {
  user: UserEntity;
  accessToken: string;
}

/** 소셜 회원가입 (쓰기 경로). 검증 → 중복확인 → 생성 → access 토큰 발급. */
@Injectable()
export class SignupUseCase {
  constructor(
    private readonly verifiers: SocialVerifierRegistry,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly tokens: TokenService,
  ) {}

  async execute(command: SignupCommand): Promise<SignupResult> {
    // 1. provider access_token 검증 (출처 → 신원) → 정규화된 프로필
    const profile = await this.verifiers
      .resolve(command.provider)
      .verify(command.accessToken);

    // 2. 이미 가입된 소셜 신원이면 409 (로그인은 별도 작업)
    const existing = await this.users.findByProviderIdentity(
      profile.provider,
      profile.providerUserId,
    );
    if (existing) {
      throw new ConflictException('already registered');
    }

    // 3. 유저가 입력한 nickname 으로 엔티티 생성 (provider 프로필이 아니라)
    const entity = UserEntity.createFromSocial({
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      email: profile.email,
      nickname: command.nickname,
    });

    // 4. 저장 — 사전 체크와 DB 유니크 제약 둘 다 409 로 수렴(레이스 안전)
    const saved = await this.saveOrConflict(entity);

    // 5. 자체 access 토큰 발급
    const accessToken = await this.tokens.issueAccessToken(
      saved.id,
      saved.provider,
    );

    return { user: saved, accessToken };
  }

  private async saveOrConflict(entity: UserEntity): Promise<UserEntity> {
    try {
      return await this.users.save(entity);
    } catch (error) {
      if (error instanceof UserAlreadyExistsError) {
        throw new ConflictException('already registered');
      }
      if (error instanceof NicknameAlreadyTakenError) {
        throw new ConflictException('nickname already taken');
      }
      throw error;
    }
  }
}
