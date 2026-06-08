import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { SignupUserUseCase } from '../application/signup-user.usecase';
import { SignupDto } from './dto/signup.dto';
import { ZodResponse } from 'nestjs-zod';
import { AuthTokensDto } from './dto/auth-tokens.dto';
import { ApiErrors } from '../../../common/swagger/api-errors.decorator';
import {
  InvalidRefreshTokenError,
  InvalidSocialTokenError,
} from '../domain/auth.error';
import {
  InvalidNicknameError,
  NicknameTakenError,
  UserAlreadyRegisteredError,
  UserNotFoundError,
} from '../../user/domain/user.error';
import { type Request } from 'express';
import { ClientPlatform } from '../domain/client-platform';
import { LoginDto } from './dto/login.dto';
import { LoginUserUseCase } from '../application/login-user.usecase';
import { RefreshSessionUseCase } from '../application/refresh-session.usecase';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutUseCase } from '../application/logout.usecase';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly signupUser: SignupUserUseCase,
    private readonly loginUser: LoginUserUseCase,
    private readonly refreshSession: RefreshSessionUseCase,
    private readonly logoutUser: LogoutUseCase,
  ) {}

  @Post('signup')
  @ApiErrors(
    InvalidSocialTokenError,
    NicknameTakenError,
    UserAlreadyRegisteredError,
    InvalidNicknameError,
  )
  @ZodResponse({ status: 201, description: '회원가입', type: AuthTokensDto })
  async signup(@Body() dto: SignupDto, @Req() req: Request) {
    return this.signupUser.execute({
      provider: dto.provider,
      accessToken: dto.accessToken,
      nickname: dto.nickname,
      device: this.toDevice(dto, req),
    });
  }

  @Post('login')
  @HttpCode(200)
  @ApiErrors(InvalidSocialTokenError, UserNotFoundError)
  @ZodResponse({ status: 200, type: AuthTokensDto })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.loginUser.execute({
      provider: dto.provider,
      accessToken: dto.accessToken,
      device: this.toDevice(dto, req),
    });
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiErrors(InvalidRefreshTokenError)
  @ZodResponse({ status: 200, type: AuthTokensDto })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.refreshSession.execute({ refreshToken: dto.refreshToken });
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshTokenDto) {
    await this.logoutUser.execute({ refreshToken: dto.refreshToken });
  }

  private toDevice(
    dto: { platform: ClientPlatform; deviceName?: string },
    req: Request,
  ) {
    return {
      platform: dto.platform,
      deviceName: dto.deviceName ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    };
  }
}
