import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { validateEnv } from './config/env.validation';
import { AppController } from './app.controller';
import { DrizzleModule } from './database/drizzle.module';
import { AuthModule } from './features/auth/auth.module';
import { UserModule } from './features/user/user.module';
import { FileModule } from './features/file/file.module';
import { PlantModule } from './features/plant/plant.module';
import { UserPlantModule } from './features/user-plant/user-plant.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { loggerModule } from './common/logger/logger.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    DrizzleModule,
    loggerModule,
    AuthModule,
    UserModule,
    FileModule,
    PlantModule,
    UserPlantModule,
  ],
  controllers: [AppController],
  providers: [
    // 요청은 Zod DTO 로 검증, 응답은 @ZodResponse 데코된 핸들러를 Zod 로 직렬화(누출 방지).
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
