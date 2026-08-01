import { Module } from '@nestjs/common';
import { PostModule } from '../post/post.module';
import { DeleteUserUseCase } from './application/delete-user.usecase';
import { UpdateUserUseCase } from './application/update-user.usecase';
import { UserController } from './presentation/user.controller';
import { UserWriter } from './repository/user.writer';
import { UserReader } from './repository/user.reader';

@Module({
  // 회원탈퇴가 post_likes를 지우며 posts.likeCount를 일괄 감소시킨다 — 두 테이블 모두
  // post 모듈이 소유하므로 "사용 → 소유" 한 방향으로 import한다(CommentModule → PostModule
  // 전례). 순환 없음: PostModule은 FileModule(imports 0)만 import하고 user를 모른다.
  //
  // 탈퇴 유스케이스가 auth가 아니라 여기 사는 이유: 라우트가 /users/me이고 엔티티 소유자가
  // user다(§3 엔티티 소유권). auth에 두는 대안은 방향이 뒤집힌다 — AuthModule → UserModule이
  // 이미 있고, 세션 폐기는 sessions.userId cascade가 이미 해서 auth의 협조가 필요 없다.
  imports: [PostModule],
  controllers: [UserController],
  providers: [UpdateUserUseCase, DeleteUserUseCase, UserWriter, UserReader],
  exports: [UserWriter, UserReader],
})
export class UserModule {}
