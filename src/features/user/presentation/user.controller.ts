import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import { ApiNoContentResponse } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { Authenticated } from '../../auth/presentation/authenticated.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth-user';
import { ApiErrors } from '../../../common/swagger/api-errors.decorator';
import { DeleteUserUseCase } from '../application/delete-user.usecase';
import { UpdateUserUseCase } from '../application/update-user.usecase';
import { UserQueryService } from '../application/user-query.service';
import {
  InvalidNicknameError,
  InvalidProfileImageError,
  NicknameTakenError,
  ProfileImageNotUploadedError,
  UserNotFoundError,
} from '../domain/user.error';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserProfileDto } from './dto/user-profile.dto';

@Controller('users')
export class UserController {
  constructor(
    private readonly updateUser: UpdateUserUseCase,
    private readonly deleteUser: DeleteUserUseCase,
    private readonly userQuery: UserQueryService,
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
    // 아바타 key → 읽기 URL 조합이 생겨 "조합 있음"이 됐다 → 쿼리 서비스 경유(§2).
    const profile = await this.userQuery.findMyProfile(user.id);
    // 무상태 JWT라 "행이 사라진 토큰"이 표현 가능 — 404.
    if (!profile) throw new UserNotFoundError();
    return profile;
  }

  @Patch('me')
  @Authenticated()
  @ApiErrors(
    UserNotFoundError,
    InvalidNicknameError,
    NicknameTakenError,
    InvalidProfileImageError,
    ProfileImageNotUploadedError,
  )
  @ZodResponse({
    status: 200,
    description:
      '내 프로필 부분 수정 (JSON Merge Patch — nickname · profileImageKey). ' +
      '필드 부재 = 미변경, null = 해제(profileImageKey만), 값 = 교체. ' +
      '응답 = GET /users/me와 같은 조회 표현',
    type: UserProfileDto,
  })
  async update(
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthUser,
  ): Promise<UserProfileDto> {
    await this.updateUser.execute({
      id: user.id,
      nickname: dto.nickname,
      profileImageKey: dto.profileImageKey,
    });

    // 수정 200 = 조회 표현(재조회) — user-plant PATCH와 동일 패턴.
    const profile = await this.userQuery.findMyProfile(user.id);
    // 방금 수정한 행이라 실패는 불변식 위반 — 404가 아니라 500(unexpected)이 정직하다.
    if (!profile) throw new Error(`updated user not readable: ${user.id}`);
    return profile;
  }

  // 대상은 항상 JWT sub(본인) — 남의 계정을 지우는 경로는 만들지 않는다(admin이 생기면 별도).
  // BlockController도 @Controller('users')지만 DELETE :userId/block은 2세그먼트라 안 부딪힌다.
  @Delete('me')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiErrors(UserNotFoundError)
  // ZodResponse는 zod DTO가 필수라 본문 없는 204엔 못 쓴다 — 댓글·글 삭제와 같은 조합.
  @ApiNoContentResponse({
    description:
      '회원탈퇴 — 계정을 즉시 하드 삭제한다(유예기간·복구 없음, 같은 소셜 계정으로 재가입 가능). ' +
      '⚠️ **작성한 글은 댓글·좋아요와 함께 전부 삭제된다**(글 삭제 = 스레드 전체 소멸이라는 ' +
      '게시판 관례를 그대로 적용 — 타인이 그 글에 단 댓글도 사라진다). 세션·내 식물·물주기· ' +
      '차단도 함께 소멸한다. ' +
      '반면 **남의 글에 단 댓글은 남고 작성자 표시만 사라진다**(응답의 author: null) — 답글이 ' +
      '달린 스레드를 지키기 위함이다. ' +
      '클라는 확인 다이얼로그에서 "작성한 글이 모두 삭제된다"를 반드시 고지해야 한다. ' +
      '남은 access token은 만료까지 유효하지만 모든 쓰기가 401이 되고 GET /users/me는 404다',
  })
  async remove(@CurrentUser() user: AuthUser): Promise<void> {
    await this.deleteUser.execute({ id: user.id });
  }
}
