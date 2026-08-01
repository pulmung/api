import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { DrizzleDB } from '../../../database/drizzle.constants';
import type { DrizzleTransactionalAdapter } from '../../../database/drizzle-transactional.adapter';
import { SocialProvider } from '../domain/social-provider';
import { users } from '../../../database/schema';
import { and, eq } from 'drizzle-orm';

@Injectable()
export class UserReader {
  constructor(
    private readonly txHost: TransactionHost<DrizzleTransactionalAdapter>,
  ) {}

  // 진행 중인 트랜잭션이 있으면 그 핸들을, 없으면 평범한 db를 준다(CLS가 고른다) —
  // 덕분에 이 어댑터의 쿼리는 트랜잭션 안팎에서 같은 코드로 동작한다.
  private get db(): DrizzleDB {
    return this.txHost.tx;
  }

  async findByProviderUserId(provider: SocialProvider, providerUserId: string) {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.provider, provider),
          eq(users.providerUserId, providerUserId),
        ),
      );

    return user ?? null;
  }

  // 프로필 행 — providerUserId 제외(내부 식별자, 응답에 안 나간다 — 부분 select가 옵트인 프로젝션).
  async findById(id: string) {
    const [user] = await this.db
      .select({
        id: users.id,
        provider: users.provider,
        email: users.email,
        nickname: users.nickname,
        // 불투명 key — 읽기 URL 조합은 UserQueryService 몫(reader는 순수 DB 접근, §2).
        profileImageKey: users.profileImageKey,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, id));

    return user ?? null;
  }
}
