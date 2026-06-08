import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.validation';
import { AuthController } from './presentation/auth.controller';
import { SignupUserUseCase } from './application/signup-user.usecase';
import { SocialIdentityVerifier } from './infrastructure/social/identity.verifier';
import { JwtTokenIssuer } from './infrastructure/jwt-token.issuer';
import { LoginUserUseCase } from './application/login-user.usecase';
import { SessionReader } from './repository/session.reader';
import { SessionWriter } from './repository/session.writer';
import { SessionIssuer } from './application/session.issuer';
import { RefreshSessionUseCase } from './application/refresh-session.usecase';
import { LogoutUseCase } from './application/logout.usecase';

@Module({
  imports: [
    UserModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_ACCESS_EXPIRES_IN', { infer: true }),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    SignupUserUseCase,
    SocialIdentityVerifier,
    JwtTokenIssuer,
    LoginUserUseCase,
    SessionReader,
    SessionWriter,
    SessionIssuer,
    RefreshSessionUseCase,
    LogoutUseCase,
  ],
})
export class AuthModule {}
