import { applyDecorators, Type } from '@nestjs/common';
import { DomainError } from '../errors/domain.error';
import { ApiResponse } from '@nestjs/swagger';

export function ApiErrors(...errors: Type<DomainError>[]) {
  // status → errorCode[] 로 그룹핑 (같은 status에 여러 코드 가능: 409 = 닉네임중복/이미가입)
  const byStatus = new Map<number, string[]>();
  for (const ErrorClass of errors) {
    const { status, code } = new ErrorClass();
    const codes = byStatus.get(status) ?? [];
    if (!codes.includes(code)) codes.push(code);
    byStatus.set(status, codes);
  }

  const responses = [...byStatus.entries()].map(([status, codes]) =>
    ApiResponse({
      status,
      schema: {
        type: 'object',
        required: ['statusCode', 'errorCode', 'message'],
        properties: {
          statusCode: { type: 'number', example: status },
          errorCode: { type: 'string', enum: codes },
          message: { type: 'string' },
        },
      },
    }),
  );

  return applyDecorators(...responses);
}
