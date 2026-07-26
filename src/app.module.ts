import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ClsModule } from 'nestjs-cls';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { validateEnv } from './config/env.validation';
import { AppController } from './app.controller';
import { DrizzleModule } from './database/drizzle.module';
import { DrizzleTransactionalAdapter } from './database/drizzle-transactional.adapter';
import { AuthModule } from './features/auth/auth.module';
import { UserModule } from './features/user/user.module';
import { FileModule } from './features/file/file.module';
import { PlantModule } from './features/plant/plant.module';
import { UserPlantModule } from './features/user-plant/user-plant.module';
import { PostModule } from './features/post/post.module';
import { CommentModule } from './features/comment/comment.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { loggerModule } from './common/logger/logger.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    DrizzleModule,
    // 트랜잭션 경계를 유스케이스가 소유하기 위한 배선(@Transactional).
    // AsyncLocalStorage에 트랜잭션 핸들을 실어 어댑터들이 같은 트랜잭션에 붙는다 →
    // writer 시그니처에 tx를 흘리지 않고도 유스케이스가 여러 어댑터를 원자적으로 조합한다.
    // ⚠️ CLS 컨텍스트 밖(크론·큐 컨슈머 등 HTTP 요청 밖)에서 @Transactional을 쓰려면
    //    진입점을 cls.run()으로 감싸야 한다 — 안 그러면 트랜잭션 없이 조용히 돈다.
    //    지금 진입점은 HTTP뿐이라 middleware mount로 충분하다(시드 스크립트는 Nest 밖).
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
      plugins: [
        new ClsPluginTransactional({
          imports: [DrizzleModule],
          adapter: new DrizzleTransactionalAdapter(),
        }),
      ],
    }),
    loggerModule,
    AuthModule,
    UserModule,
    FileModule,
    PlantModule,
    UserPlantModule,
    PostModule,
    CommentModule,
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
