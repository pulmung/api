import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
import { User } from '../domain/user';
import {
  UNIQUE_USERS_NICKNAME,
  UNIQUE_USERS_PROVIDER_ACCOUNT,
  users,
} from '../../../database/schema';
import { DatabaseError } from 'pg';
import {
  NicknameTakenError,
  UserAlreadyRegisteredError,
} from '../domain/user.error';

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
      if (e instanceof DatabaseError && e.code === '23505') {
        //unique
        if (e.constraint === UNIQUE_USERS_NICKNAME)
          throw new NicknameTakenError();
        if (e.constraint === UNIQUE_USERS_PROVIDER_ACCOUNT)
          throw new UserAlreadyRegisteredError();
      }
      throw e;
    }
  }
}
