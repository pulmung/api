import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
import { SocialProvider } from '../domain/social-provider';
import { users } from '../../../database/schema';
import { and, eq } from 'drizzle-orm';

@Injectable()
export class UserReader {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

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
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, id));

    return user ?? null;
  }
}
