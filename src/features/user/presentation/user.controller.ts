import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { Authenticated } from '../../auth/presentation/authenticated.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth-user';
import { ApiErrors } from '../../../common/swagger/api-errors.decorator';
import { UpdateUserUseCase } from '../application/update-user.usecase';
import {
  InvalidNicknameError,
  NicknameTakenError,
  UserNotFoundError,
} from '../domain/user.error';
import { UserReader } from '../repository/user.reader';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserProfileDto } from './dto/user-profile.dto';

@Controller('users')
export class UserController {
  constructor(
    private readonly updateUser: UpdateUserUseCase,
    private readonly userReader: UserReader,
  ) {}

  @Get('me')
  @Authenticated()
  @ApiErrors(UserNotFoundError)
  @ZodResponse({
    status: 200,
    description: '내 프로필 — 대상은 항상 JWT sub(본인)',
    type: UserProfileDto,
  })
  async me(@CurrentUser() user: AuthUser): Promise<UserProfileDto> {
    // 조합 0(파일 URL·조인 없음) — controller → reader 직행(§2).
    const profile = await this.userReader.findById(user.id);
    // 무상태 JWT라 "행이 사라진 토큰"이 표현 가능 — 404.
    if (!profile) throw new UserNotFoundError();
    // z.iso.datetime()은 Date를 거부한다 — 쿼리 서비스가 없으니 직렬화는 여기서.
    return { ...profile, createdAt: profile.createdAt.toISOString() };
  }

  @Patch('me')
  @Authenticated()
  @ApiErrors(UserNotFoundError, InvalidNicknameError, NicknameTakenError)
  @ZodResponse({
    status: 200,
    description:
      '내 프로필 부분 수정 (JSON Merge Patch — 현재 nickname만). 응답 = GET /users/me와 같은 조회 표현',
    type: UserProfileDto,
  })
  async update(
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthUser,
  ): Promise<UserProfileDto> {
    await this.updateUser.execute({ id: user.id, nickname: dto.nickname });

    // 수정 200 = 조회 표현(재조회) — user-plant PATCH와 동일 패턴.
    const profile = await this.userReader.findById(user.id);
    // 방금 수정한 행이라 실패는 불변식 위반 — 404가 아니라 500(unexpected)이 정직하다.
    if (!profile) throw new Error(`updated user not readable: ${user.id}`);
    return { ...profile, createdAt: profile.createdAt.toISOString() };
  }
}
