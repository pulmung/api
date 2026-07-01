import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ApiErrors } from '../../../common/swagger/api-errors.decorator';
import { UnauthenticatedError } from '../domain/auth.error';
import { JwtAuthGuard } from '../infrastructure/jwt-auth.guard';

// 보호 라우트에 붙인다: 가드(enforcement) + bearer 문서 + 401 문서를 한 번에.
export const Authenticated = () =>
  applyDecorators(
    UseGuards(JwtAuthGuard),
    ApiBearerAuth(),
    ApiErrors(UnauthenticatedError),
  );
