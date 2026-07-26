import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
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
    // @ApiBearerAuth()가 아니라 security를 직접 쓴다 — 전자는 `[{bearer: []}]`(= 인증 필수)를
    // 내보내 공개 라우트를 거짓말하게 만든다. 빈 요구사항 `{}`가 "무인증도 허용"의 OpenAPI
    // 표기이고, 순서상 먼저 둬야 codegen이 토큰을 선택 파라미터로 뽑는다(§9 계약 정확성).
    ApiOperation({ security: [{}, { bearer: [] }] }),
    // 토큰을 "보냈다면" 유효해야 하므로 401은 여전히 이 라우트의 실제 응답이다.
    ApiErrors(UnauthenticatedError),
  );
