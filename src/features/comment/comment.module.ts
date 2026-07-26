import { Module } from '@nestjs/common';
import { PostModule } from '../post/post.module';
import { CreateCommentUseCase } from './application/create-comment.usecase';
import { CreateReplyUseCase } from './application/create-reply.usecase';
import { UpdateCommentUseCase } from './application/update-comment.usecase';
import { DeleteCommentUseCase } from './application/delete-comment.usecase';
import { CommentQueryService } from './application/comment-query.service';
import { CommentWriter } from './repository/comment.writer';
import { CommentReader } from './repository/comment.reader';
import { PostCommentController } from './presentation/post-comment.controller';
import { CommentController } from './presentation/comment.controller';

@Module({
  // PostWriter를 쓰기 위해 PostModule을 import한다 — posts.commentCount 증감을 댓글 쓰기와
  // **같은 트랜잭션**에 태우는데, posts 테이블의 쓰기는 post 모듈이 소유하기 때문이다.
  // (예전엔 comment.writer가 posts를 직접 UPDATE해서 이 의존이 코드에만 있고 모듈엔
  //  안 보였다 — 경계를 넘겨 쓰면 exports/imports로 드러낸다는 §3의 원칙대로 명시화.)
  // users 의존은 여전히 DB 레벨(FK·읽기 join)뿐이라 UserModule은 불필요하다.
  imports: [PostModule],
  controllers: [PostCommentController, CommentController],
  providers: [
    CreateCommentUseCase,
    CreateReplyUseCase,
    UpdateCommentUseCase,
    DeleteCommentUseCase,
    CommentQueryService,
    CommentWriter,
    CommentReader,
  ],
})
export class CommentModule {}
