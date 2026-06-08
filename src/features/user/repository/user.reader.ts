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
}
