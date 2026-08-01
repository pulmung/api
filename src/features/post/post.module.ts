import { Module } from '@nestjs/common';
import { FileModule } from '../file/file.module';
import { CreatePostUseCase } from './application/create-post.usecase';
import { UpdatePostUseCase } from './application/update-post.usecase';
import { DeletePostUseCase } from './application/delete-post.usecase';
import { PostQueryService } from './application/post-query.service';
import { LikePostUseCase } from './application/like-post.usecase';
import { UnlikePostUseCase } from './application/unlike-post.usecase';
import { PostWriter } from './repository/post.writer';
import { PostReader } from './repository/post.reader';
import { PostLikeWriter } from './repository/post-like.writer';
import { PostController } from './presentation/post.controller';
import { PostLikeController } from './presentation/post-like.controller';

@Module({
  // S3FileStorage(head 실존 검증) + PublicFileUrlResolver(URL↔key) seam
  // ("사용 → 소유" 한 방향: post → file). users/plants 의존은 모듈이 아니라
  // DB 레벨(FK·읽기 join)에만 있다 — UserModule/PlantModule import 불필요(user-plant 전례).
  //
  // 좋아요는 별도 모듈을 만들지 않는다. 전례는 **waterings**다: 자체 테이블·하위 리소스
  // 컨트롤러(`user-plants/:id/waterings`)·writer·reader·유스케이스·도메인 예외까지 갖고도
  // WateringModule이 아니라 UserPlantModule 안에 산다. 좋아요는 그보다도 독립성이 낮다 —
  // 엔티티도 불변식도 도메인 예외도 자기 id도 없고(상태 전체가 (post,user) 쌍, 유일성은 DB
  // 몫), 읽기 경로(isLiked)는 post의 read model 안에 있다. 쪼개면 post_likes를 두 모듈이
  // 공동 소유하게 될 뿐이라 경계가 사줄 게 없다(§0 비용 계산).
  // CommentModule이 독립인 건 "하위 리소스라서"가 아니라 진짜 도메인(엔티티·2계층 불변식·
  // soft delete·자체 에러 카탈로그 + 얕은 라우트 /comments/:id)이 있어서다.
  // 추출 트리거: 좋아요가 자기 도메인을 갖게 되면(알림 팬아웃·레이트리밋·"좋아요한 글" 피드).
  imports: [FileModule],
  controllers: [PostController, PostLikeController],
  providers: [
    CreatePostUseCase,
    UpdatePostUseCase,
    DeletePostUseCase,
    LikePostUseCase,
    UnlikePostUseCase,
    PostQueryService,
    PostWriter,
    PostReader,
    PostLikeWriter,
  ],
  // posts·post_likes 테이블의 쓰기는 이 모듈이 소유한다 — 비정규화 카운터를 같은
  // 트랜잭션에서 증감해야 하는 소비처에 공개한다("사용 → 소유" §3):
  //   CommentModule → PostWriter                  (commentCount)
  //   UserModule    → PostWriter + PostLikeWriter (탈퇴 시 좋아요 정리 + likeCount 일괄 감소)
  // ⚠️ 위 imports가 UserModule을 포함하지 않는다는 사실이 이제 load-bearing이다 —
  //    포함하면 user ⇄ post 순환이 생긴다(users 의존은 계속 FK·읽기 join 레벨로만 둘 것).
  exports: [PostWriter, PostLikeWriter],
})
export class PostModule {}
