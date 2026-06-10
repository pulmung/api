import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { Env } from './config/env.validation';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get<ConfigService<Env, true>>(ConfigService);
  app.useLogger(app.get(Logger));

  app.set(
    'trust proxy',
    configService.get('TRUST_PROXY_HOPS', { infer: true }),
  );
  app.enableCors({
    origin: configService.get('CORS_ORIGINS', { infer: true }),
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });

  // OpenAPI 스펙을 단일 소스로 노출 → web/mobile codegen 입력.
  // cleanupOpenApiDoc: nestjs-zod 가 생성한 스키마를 OpenAPI 규격으로 후처리(필수).
  const openApiDoc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('sikjipsa API')
      .setVersion('1.0')
      // OpenAPI 3.1 = JSON Schema 정렬 → nestjs-zod 의 네이티브 출력(3.0은 down-convert).
      // null 을 anyOf 로 표현 → web/mobile codegen 입력으로 더 적합.
      .setOpenAPIVersion('3.1.0')
      .build(),
  );
  SwaggerModule.setup('swagger', app, cleanupOpenApiDoc(openApiDoc));

  await app.listen(configService.get('PORT', { infer: true }));
}
void bootstrap();
