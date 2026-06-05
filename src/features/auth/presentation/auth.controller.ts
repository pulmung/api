import { Body, Controller, Post } from '@nestjs/common';
import { SignupUserUseCase } from '../application/signup-user.usecase';
import { SignupDto } from './dto/signup.dto';
import { ZodResponse } from 'nestjs-zod';
import { AuthTokensDto } from './dto/auth-tokens.dto';
import { ApiErrors } from '../../../common/swagger/api-errors.decorator';
import { InvalidSocialTokenError } from '../domain/auth.error';
import {
  InvalidNicknameError,
  NicknameTakenError,
  UserAlreadyRegisteredError,
} from '../../user/domain/user.error';

@Controller('auth')
export class AuthController {
  constructor(private readonly signupUser: SignupUserUseCase) {}

  @Post('signup')
  @ApiErrors(
    InvalidSocialTokenError,
    NicknameTakenError,
    UserAlreadyRegisteredError,
    InvalidNicknameError,
  )
  @ZodResponse({ status: 201, description: '회원가입', type: AuthTokensDto })
  async signup(@Body() dto: SignupDto) {
    return this.signupUser.execute(dto);
  }
}
