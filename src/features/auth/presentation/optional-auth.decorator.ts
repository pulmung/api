import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ApiErrors } from '../../../common/swagger/api-errors.decorator';
import { UnauthenticatedError } from '../domain/auth.error';
import {
  JwtAuthGuard,
  IS_OPTIONAL_AUTH_KEY,
} from '../infrastructure/jwt-auth.guard';

// 선택적 인증 라우트: 토큰 없으면 익명 통과, 있으면 검증(잘못됐으면 401).
export const OptionalAuth = () =>
  applyDecorators(
    UseGuards(JwtAuthGuard),
    SetMetadata(IS_OPTIONAL_AUTH_KEY, true),
    ApiBearerAuth(),
    ApiErrors(UnauthenticatedError),
  );
