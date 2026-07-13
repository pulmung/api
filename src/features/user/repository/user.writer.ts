import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
import { User } from '../domain/user';
import {
  UNIQUE_USERS_NICKNAME,
  UNIQUE_USERS_PROVIDER_ACCOUNT,
  users,
  type NewUser,
} from '../../../database/schema';
import { DatabaseError } from 'pg';
import {
  NicknameTakenError,
  UserAlreadyRegisteredError,
} from '../domain/user.error';
import { DrizzleQueryError, eq } from 'drizzle-orm';
import { PG_ERROR_CODE } from '../../../database/postgres-error';

@Injectable()
export class UserWriter {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(user: User) {
    try {
      await this.db.insert(users).values({
        id: user.id,
        provider: user.provider,
        providerUserId: user.providerUserId,
        email: user.email,
        nickname: user.nickname,
      });
    } catch (e) {
      const cause = e instanceof DrizzleQueryError ? e.cause : e;
      if (
        cause instanceof DatabaseError &&
        cause.code === PG_ERROR_CODE.UNIQUE_VIOLATION
      ) {
        if (cause.constraint === UNIQUE_USERS_NICKNAME)
          throw new NicknameTakenError();
        if (cause.constraint === UNIQUE_USERS_PROVIDER_ACCOUNT)
          throw new UserAlreadyRegisteredError();
      }
      throw e;
    }
  }

  /** @returns false = 비존재 (무상태 JWT sub가 가리키는 행이 사라진 경우) */
  async update(id: string, patch: { nickname?: string }): Promise<boolean> {
    // undefined 필드는 SET에서 제외 = 컬럼을 건드리지 않는다(merge-patch).
    // 빈 패치는 DTO(400)가 경계에서 막는다 — drizzle .set({})은 throw.
    const set: Partial<NewUser> = {};
    if (patch.nickname !== undefined) set.nickname = patch.nickname;

    try {
      // RETURNING id로 0행(=404) 감지 — user-plant writer와 동일 관용구.
      const rows = await this.db
        .update(users)
        .set(set)
        .where(eq(users.id, id))
        .returning({ id: users.id });
      return rows.length > 0;
    } catch (e) {
      const cause = e instanceof DrizzleQueryError ? e.cause : e;
      if (
        cause instanceof DatabaseError &&
        cause.code === PG_ERROR_CODE.UNIQUE_VIOLATION &&
        cause.constraint === UNIQUE_USERS_NICKNAME
      ) {
        throw new NicknameTakenError();
      }
      // 이 UPDATE는 nickname만 만지므로 provider 유니크는 못 뜬다 — 모르는 에러는 rethrow(§7).
      throw e;
    }
  }
}
