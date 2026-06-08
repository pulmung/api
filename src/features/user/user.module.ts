import { Module } from '@nestjs/common';
import { UserWriter } from './repository/user.writer';
import { UserReader } from './repository/user.reader';

@Module({
  providers: [UserWriter, UserReader],
  exports: [UserWriter, UserReader],
})
export class UserModule {}
