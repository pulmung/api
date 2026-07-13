import { Module } from '@nestjs/common';
import { UpdateUserUseCase } from './application/update-user.usecase';
import { UserController } from './presentation/user.controller';
import { UserWriter } from './repository/user.writer';
import { UserReader } from './repository/user.reader';

@Module({
  controllers: [UserController],
  providers: [UpdateUserUseCase, UserWriter, UserReader],
  exports: [UserWriter, UserReader],
})
export class UserModule {}
