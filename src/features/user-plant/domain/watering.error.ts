import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';

// 비존재·타 개체 소속·타인 소유 모두 이 하나로 수렴 — UserPlantNotFoundError와
// 같은 존재 은닉 원칙.
export class WateringNotFoundError extends DomainError {
  readonly code = 'WATERING_NOT_FOUND';
  readonly status = HttpStatus.NOT_FOUND;
}
