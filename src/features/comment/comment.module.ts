import { Module } from '@nestjs/common';
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
  // posts/users 의존은 모듈이 아니라 DB 레벨(FK·읽기 join·카운터 UPDATE)에만 있다 —
  // PostModule/UserModule import 불필요(post 전례). 파일 첨부가 없어 FileModule도 불요.
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
