import { Module } from '@nestjs/common';
import { FileModule } from '../file/file.module';
import { CreatePostUseCase } from './application/create-post.usecase';
import { UpdatePostUseCase } from './application/update-post.usecase';
import { DeletePostUseCase } from './application/delete-post.usecase';
import { PostQueryService } from './application/post-query.service';
import { PostWriter } from './repository/post.writer';
import { PostReader } from './repository/post.reader';
import { PostController } from './presentation/post.controller';

@Module({
  // S3FileStorage(head 실존 검증) + PublicFileUrlResolver(URL↔key) seam
  // ("사용 → 소유" 한 방향: post → file). users/plants 의존은 모듈이 아니라
  // DB 레벨(FK·읽기 join)에만 있다 — UserModule/PlantModule import 불필요(user-plant 전례).
  imports: [FileModule],
  controllers: [PostController],
  providers: [
    CreatePostUseCase,
    UpdatePostUseCase,
    DeletePostUseCase,
    PostQueryService,
    PostWriter,
    PostReader,
  ],
})
export class PostModule {}
