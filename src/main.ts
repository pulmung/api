import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { Env } from './config/env.validation';
import { Logger } from 'nestjs-pino';
import { createOpenApiDocument } from './openapi';

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

  SwaggerModule.setup('swagger', app, createOpenApiDocument(app));

  await app.listen(configService.get('PORT', { infer: true }));
}
void bootstrap();
