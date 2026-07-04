import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const FileUploadTargetSchema = z.object({
  key: z.string().meta({
    description:
      '업로드 후 도메인 리소스 생성 요청(예: 식물 등록)에 첨부할 불투명 key',
    example: 'plant-image/0198c5b2-2f74-7abc-8def-0123456789ab.jpg',
  }),
  upload: z.object({
    url: z.url().meta({ description: 'S3 presigned POST 대상 URL' }),
    fields: z
      .record(z.string(), z.string())
      .meta({ description: 'POST form에 그대로 실어야 하는 서명 필드들' }),
    expiresAt: z.iso.datetime().meta({ description: 'presign 만료 시각' }),
  }),
});

export class FileUploadTargetDto extends createZodDto(FileUploadTargetSchema) {}
