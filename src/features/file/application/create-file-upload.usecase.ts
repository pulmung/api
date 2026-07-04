import { Injectable } from '@nestjs/common';
import { prepareFileUpload } from '../domain/file-upload';
import { FilePurpose } from '../domain/file-purpose';
import { S3FileStorage } from '../infrastructure/s3-file.storage';

@Injectable()
export class CreateFileUploadUseCase {
  constructor(private readonly storage: S3FileStorage) {}

  async execute(command: {
    purpose: FilePurpose;
    contentType: string;
    size?: number;
  }) {
    const { key, maxSizeBytes } = prepareFileUpload(command);

    const upload = await this.storage.createUploadTarget({
      key,
      contentType: command.contentType,
      maxSizeBytes,
    });

    // DB에 아무것도 쓰지 않는다(stateless presign) — key는 첨부 시점에 소비처 도메인이 저장.
    return { key, upload };
  }
}
