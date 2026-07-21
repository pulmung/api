import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';

// 비존재와 타인 글 모두 이 하나로(존재 은닉) — user-plant와 동일 결. 읽기(GET :id)는
// 공개 리소스라 진짜 비존재만 해당하지만, 쓰기(PATCH/DELETE)는 타인 글도 여기로 수렴한다.
export class PostNotFoundError extends DomainError {
  readonly code = 'POST_NOT_FOUND';
  readonly status = HttpStatus.NOT_FOUND;
}

export class InvalidPostTitleError extends DomainError {
  readonly code = 'INVALID_POST_TITLE';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

// 본문 규약 위반 — 원문 길이 초과 · 알맹이 없음(공백/서식뿐, 텍스트도 이미지도 0) ·
// 이미지 수 초과. src 문제는 별도 에러(InvalidPostImageSrcError)로 가른다.
export class InvalidPostContentError extends DomainError {
  readonly code = 'INVALID_POST_CONTENT';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

// img src가 우리 이미지 도메인 밖이거나 post-image purpose의 key가 아님.
// 내용 위반(INVALID_POST_CONTENT)과 구분 — 이건 대개 에디터 연동 버그 신호다.
export class InvalidPostImageSrcError extends DomainError {
  readonly code = 'INVALID_POST_IMAGE_SRC';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

// presign만 받고 실제 업로드하지 않은 key를 본문이 참조한 경우 (S3 head 실존 검증 실패).
export class PostImageNotUploadedError extends DomainError {
  readonly code = 'POST_IMAGE_NOT_UPLOADED';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

// body의 plantId가 존재하지 않는 카탈로그를 가리킴 (INSERT/UPDATE 시 FK 23503).
// 404가 아니라 422 — 404는 라우트 대상(URL)의 부재이고, 이건 본문 참조의 부재다.
export class ReferencedPlantNotFoundError extends DomainError {
  readonly code = 'REFERENCED_PLANT_NOT_FOUND';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}
