import { Module } from '@nestjs/common';
import { UserWriter } from './repository/user.writer';

@Module({
  providers: [UserWriter],
  exports: [UserWriter],
})
export class UserModule {}
