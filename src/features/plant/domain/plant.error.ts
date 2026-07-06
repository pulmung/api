import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';

export class InvalidPlantNameError extends DomainError {
  readonly code = 'INVALID_PLANT_NAME';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

export class InvalidPlantImagesError extends DomainError {
  readonly code = 'INVALID_PLANT_IMAGES';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

// presign만 받고 실제 업로드하지 않은 key를 첨부한 경우 (S3 head 실존 검증 실패).
export class PlantImageNotUploadedError extends DomainError {
  readonly code = 'PLANT_IMAGE_NOT_UPLOADED';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

export class PlantNameTakenError extends DomainError {
  readonly code = 'PLANT_NAME_TAKEN';
  readonly status = HttpStatus.CONFLICT;
}

export class PlantNotFoundError extends DomainError {
  readonly code = 'PLANT_NOT_FOUND';
  readonly status = HttpStatus.NOT_FOUND;
}
