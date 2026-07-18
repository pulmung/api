import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';

export class InvalidUserPlantNameError extends DomainError {
  readonly code = 'INVALID_USER_PLANT_NAME';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

export class InvalidUserPlantImagesError extends DomainError {
  readonly code = 'INVALID_USER_PLANT_IMAGES';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

// presign만 받고 실제 업로드하지 않은 key를 첨부한 경우 (S3 head 실존 검증 실패).
export class UserPlantImageNotUploadedError extends DomainError {
  readonly code = 'USER_PLANT_IMAGE_NOT_UPLOADED';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

// body의 plantId가 존재하지 않는 카탈로그를 가리킴 (INSERT 시 FK 23503).
// 404가 아니라 422 — 404는 라우트 대상(URL)의 부재이고, 이건 본문 참조의 부재다.
export class ReferencedPlantNotFoundError extends DomainError {
  readonly code = 'REFERENCED_PLANT_NOT_FOUND';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

// 비존재와 타인 소유 모두 이 하나로 — 소유 여부를 403으로 갈라주면 id 존재가
// 새는 oracle이 된다(존재 은닉).
export class UserPlantNotFoundError extends DomainError {
  readonly code = 'USER_PLANT_NOT_FOUND';
  readonly status = HttpStatus.NOT_FOUND;
}

export class InvalidWateringIntervalError extends DomainError {
  readonly code = 'INVALID_WATERING_INTERVAL';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}
