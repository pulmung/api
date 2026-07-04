import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { filePurposes } from '../../domain/file-purpose';

const CreateFileUploadSchema = z.object({
  purpose: z.enum(filePurposes),
  // zod enum 아님(의도): 허용 타입 정책은 domain(FILE_POLICIES) 소유 — DTO 이중기재 = drift.
  // 형식 위반은 400(Zod)이 아니라 422(UnsupportedFileTypeError)로 갈라진다.
  contentType: z.string().min(1).meta({ example: 'image/jpeg' }),
  // bytes. 선택 — 알면 조기 422(FileTooLargeError), 최종 강제는 S3 policy(content-length-range).
  size: z.number().int().positive().optional(),
});

export class CreateFileUploadDto extends createZodDto(CreateFileUploadSchema) {}
