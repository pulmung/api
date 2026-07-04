import { uuidv7 } from 'uuidv7';
import {
  AllowedContentType,
  CONTENT_TYPE_EXT,
  FILE_POLICIES,
} from './file-policy';
import { FilePurpose } from './file-purpose';
import { FileTooLargeError, UnsupportedFileTypeError } from './file.error';

// 검증 + 키 발급을 한 곳에 응집 — "ext는 항상 허용된 contentType에서 파생"이 단일 불변식.
// 상태를 보유하는 엔티티가 아니므로 순수 함수(정적 팩토리 클래스는 의례).
export function prepareFileUpload(params: {
  purpose: FilePurpose;
  contentType: string;
  size?: number;
}): { key: string; maxSizeBytes: number } {
  const policy = FILE_POLICIES[params.purpose];

  if (!isAllowed(policy.allowedContentTypes, params.contentType)) {
    throw new UnsupportedFileTypeError();
  }
  // size는 조기거절용 힌트 — 최종 강제는 S3 presign policy(content-length-range).
  if (params.size !== undefined && params.size > policy.maxSizeBytes) {
    throw new FileTooLargeError();
  }

  // 불투명 키: 확장자는 유저 파일명이 아니라 contentType에서 파생. 파일명은 키에 넣지 않는다.
  return {
    key: `${params.purpose}/${uuidv7()}.${CONTENT_TYPE_EXT[params.contentType]}`,
    maxSizeBytes: policy.maxSizeBytes,
  };
}

function isAllowed(
  allowed: readonly AllowedContentType[],
  contentType: string,
): contentType is AllowedContentType {
  return (allowed as readonly string[]).includes(contentType);
}
