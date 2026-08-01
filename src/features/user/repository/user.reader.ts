import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { DrizzleDB } from '../../../database/drizzle.constants';
import type { DrizzleTransactionalAdapter } from '../../../database/drizzle-transactional.adapter';
import { SocialProvider } from '../domain/social-provider';
import { users } from '../../../database/schema';
import { userSummaryColumns } from './user-summary.columns';
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

  // 내 프로필 행 — providerUserId 제외(내부 식별자, 응답에 안 나간다 — 부분 select가 옵트인 프로젝션).
  // ⚠️ provider·email이 들어 있다 = **본인에게만** 나가는 행이다. 남의 프로필은 아래 findPublicById.
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

  /**
   * 남의 프로필 행 — **공개 컬럼만**. findById를 재사용하지 않는 이유가 곧 이 메서드의 존재
   * 이유다: 부분 select가 옵트인 프로젝션이므로, 공개 경로에서는 provider·email을 애초에
   * 쿼리하지 않아야 매핑 실수로 샐 여지가 없다(응답 스키마 strip에만 기대지 않는다).
   *
   * 작성자 요약 3필드는 `userSummaryColumns()`(user 소유 projection 단일 소스)를 그대로
   * 편다 — 요약에 필드가 늘면 프로필도 같이 따라온다. 응답 DTO도 `UserSummarySchema`에서
   * 파생하므로 양쪽이 같은 축으로 움직인다.
   */
  async findPublicById(id: string) {
    const [user] = await this.db
      .select({ ...userSummaryColumns(users), createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, id));

    return user ?? null;
  }
}
