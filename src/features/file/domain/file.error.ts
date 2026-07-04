import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';

export class UnsupportedFileTypeError extends DomainError {
  readonly code = 'UNSUPPORTED_FILE_TYPE';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

// 422(413 아님): 413은 실제 전송된 엔티티가 클 때. 여기선 작은 JSON 요청의 "선언된" 크기가
// 정책 위반인 것 — 실제 크기 강제는 S3 presign policy(content-length-range)가 한다.
export class FileTooLargeError extends DomainError {
  readonly code = 'FILE_TOO_LARGE';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}
