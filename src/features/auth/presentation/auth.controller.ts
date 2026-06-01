import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { SignupUseCase } from '../application/signup.usecase';
import { SignupRequestDto } from './dto/signup.request';
import { SignupResponseDto, toSignupResponse } from './dto/signup.response';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly signupUseCase: SignupUseCase) {}

  // @ZodResponse: 직렬화 DTO(@ZodSerializerDto) + OpenAPI 응답(@ApiResponse) + 201(@HttpCode)을 한 번에.
  @Post('signup')
  @ZodResponse({ status: 201, type: SignupResponseDto, description: '회원가입 성공' })
  async signup(@Body() body: SignupRequestDto) {
    const result = await this.signupUseCase.execute(body);
    return toSignupResponse(result.user, result.accessToken);
  }
}
