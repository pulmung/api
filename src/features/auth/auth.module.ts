import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SignupUseCase } from './application/signup.usecase';
import {
  SOCIAL_TOKEN_VERIFIERS,
  SocialTokenVerifier,
} from './application/social-token-verifier';
import { SocialVerifierRegistry } from './application/social-verifier.registry';
import { TokenService } from './application/token.service';
import { USER_REPOSITORY } from './domain/user.repository';
import { DrizzleUserRepository } from './infrastructure/drizzle-user.repository';
import { GoogleTokenVerifier } from './infrastructure/google-token.verifier';
import { KakaoTokenVerifier } from './infrastructure/kakao-token.verifier';
import { AuthController } from './presentation/auth.controller';

@Module({
  // 시크릿/만료를 signAsync 호출마다 명시하므로 bare 등록.
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    SignupUseCase,
    TokenService,
    SocialVerifierRegistry,
    GoogleTokenVerifier,
    KakaoTokenVerifier,
    {
      provide: SOCIAL_TOKEN_VERIFIERS,
      useFactory: (
        google: GoogleTokenVerifier,
        kakao: KakaoTokenVerifier,
      ): SocialTokenVerifier[] => [google, kakao],
      inject: [GoogleTokenVerifier, KakaoTokenVerifier],
    },
    { provide: USER_REPOSITORY, useClass: DrizzleUserRepository },
  ],
})
export class AuthModule {}
