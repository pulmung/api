import { Body, Controller, Post } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../../../common/swagger/api-errors.decorator';
import { Authenticated } from '../../auth/presentation/authenticated.decorator';
import { CreateFileUploadUseCase } from '../application/create-file-upload.usecase';
import {
  FileTooLargeError,
  UnsupportedFileTypeError,
} from '../domain/file.error';
import { CreateFileUploadDto } from './dto/create-file-upload.dto';
import { FileUploadTargetDto } from './dto/file-upload-target.dto';

@Controller('files')
export class FileController {
  constructor(private readonly createFileUpload: CreateFileUploadUseCase) {}

  @Post()
  @Authenticated()
  @ApiErrors(UnsupportedFileTypeError, FileTooLargeError)
  @ZodResponse({
    status: 201,
    description: '파일 업로드 presign 발급 (클라이언트가 S3로 직접 업로드)',
    type: FileUploadTargetDto,
  })
  async create(@Body() dto: CreateFileUploadDto) {
    return this.createFileUpload.execute({
      purpose: dto.purpose,
      contentType: dto.contentType,
      size: dto.size,
    });
  }
}
