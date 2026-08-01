import { Module } from '@nestjs/common';
import { FileModule } from '../file/file.module';
import { ModerationModule } from '../moderation/moderation.module';
import { PostModule } from '../post/post.module';
import { DeleteUserUseCase } from './application/delete-user.usecase';
import { UpdateUserUseCase } from './application/update-user.usecase';
import { UserQueryService } from './application/user-query.service';
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
  //
  // FileModule: 아바타의 첨부 시점 head() 실존 검증(S3FileStorage)과 읽기 URL 조합
  // (PublicFileUrlResolver). imports가 0인 모듈이라 순환 없음.
  //
  // ModerationModule: 공개 프로필(GET /users/:userId)의 isBlocked. 차단 상태를 user가
  // *사용*하고 moderation이 *소유*하므로 "사용 → 소유" 정방향이다(§3) — 반대로 moderation이
  // user를 import하지 않아 순환이 없다(그쪽이 쓰는 userSummaryColumns는 순수 함수라 파일
  // import로 끝난다). ⚠️ user가 차단을 *소유*하게 되면 그 순간 모양이 틀어진다 — "user가
  // 콘텐츠 가시성을 소유"는 moderation.module doc이 명시적으로 기각한 배치다.
  imports: [PostModule, FileModule, ModerationModule],
  controllers: [UserController],
  providers: [
    UpdateUserUseCase,
    DeleteUserUseCase,
    UserQueryService,
    UserWriter,
    UserReader,
  ],
  exports: [UserWriter, UserReader],
})
export class UserModule {}
