import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseError } from 'pg';
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
import { users } from '../../../database/schema';
import type { SocialProvider } from '../../../database/schema/user.schema';
import {
  NicknameAlreadyTakenError,
  UserAlreadyExistsError,
} from '../domain/errors';
import { UserEntity } from '../domain/user';
import { UserRepository } from '../domain/user.repository';

// 도메인 엔티티 복원에 필요한 컬럼만(부분 select 자동 추론).
const userColumns = {
  id: users.id,
  provider: users.provider,
  providerUserId: users.providerUserId,
  email: users.email,
  nickname: users.nickname,
};

@Injectable()
export class DrizzleUserRepository implements UserRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findByProviderIdentity(
    provider: SocialProvider,
    providerUserId: string,
  ): Promise<UserEntity | null> {
    const rows = await this.db
      .select(userColumns)
      .from(users)
      .where(
        and(
          eq(users.provider, provider),
          eq(users.providerUserId, providerUserId),
        ),
      )
      .limit(1);

    const row = rows.at(0);
    return row ? UserEntity.fromPersistence(row) : null;
  }

  async save(user: UserEntity): Promise<UserEntity> {
    try {
      const [row] = await this.db
        .insert(users)
        .values({
          id: user.id,
          provider: user.provider,
          providerUserId: user.providerUserId,
          email: user.email,
          nickname: user.nickname,
        })
        .returning(userColumns);
      return UserEntity.fromPersistence(row);
    } catch (error) {
      // pg 23505 = unique_violation. 어느 제약을 어겼는지로 분기.
      if (error instanceof DatabaseError && error.code === '23505') {
        if ((error.constraint ?? '').includes('nickname')) {
          throw new NicknameAlreadyTakenError();
        }
        throw new UserAlreadyExistsError();
      }
      throw error;
    }
  }
}
