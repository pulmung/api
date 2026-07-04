import { Module } from '@nestjs/common';
import { CreateFileUploadUseCase } from './application/create-file-upload.usecase';
import { S3FileStorage } from './infrastructure/s3-file.storage';
import { FileController } from './presentation/file.controller';

@Module({
  controllers: [FileController],
  providers: [CreateFileUploadUseCase, S3FileStorage],
  // seam: 소비처(plant 등)가 첨부 시점 head() 존재검증에 쓴다 — "사용 → 소유" 한 방향.
  exports: [S3FileStorage],
})
export class FileModule {}
