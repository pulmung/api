import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainError } from '../errors/domain.error';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    // ① 도메인 예외 → status 매핑 + errorCode
    if (exception instanceof DomainError) {
      return res.status(exception.status).json({
        statusCode: exception.status,
        errorCode: exception.code,
        message: exception.message,
      });
    }

    // ② NestJS/Zod 검증 등 HttpException → 그대로 (NestJS 표준 형태 유지)
    if (exception instanceof HttpException) {
      return res.status(exception.getStatus()).json(exception.getResponse());
    }

    // ③ unexpected → 500 + 구조화 로깅 (스택은 클라에 숨김 = 보안)
    this.logger.error(
      {
        method: req.method,
        url: req.url,
        params: req.params,
        query: req.query,
        body: req.body as unknown,
      },
      exception instanceof Error ? exception.stack : String(exception),
    );
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: 'INTERNAL',
      message: 'Internal Server Error',
    });
  }
}
