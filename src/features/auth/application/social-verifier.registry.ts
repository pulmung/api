import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { SocialProvider } from '../../../database/schema/user.schema';
import {
  SOCIAL_TOKEN_VERIFIERS,
  SocialTokenVerifier,
} from './social-token-verifier';

/**
 * provider → verifier 해석. 주입된 모든 어댑터를 provider 키로 색인한다.
 * provider 추가 = 어댑터 1개 등록(switch 분기 수정 불필요).
 */
@Injectable()
export class SocialVerifierRegistry {
  private readonly byProvider: Map<SocialProvider, SocialTokenVerifier>;

  constructor(
    @Inject(SOCIAL_TOKEN_VERIFIERS) verifiers: SocialTokenVerifier[],
  ) {
    this.byProvider = new Map(verifiers.map((v) => [v.provider, v]));
  }

  resolve(provider: SocialProvider): SocialTokenVerifier {
    const verifier = this.byProvider.get(provider);
    if (!verifier) {
      throw new BadRequestException(`unsupported provider: ${provider}`);
    }
    return verifier;
  }
}
