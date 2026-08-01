import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
} from '@nestjs/common';
import { ApiNoContentResponse } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { Authenticated } from '../../auth/presentation/authenticated.decorator';
import { OptionalAuth } from '../../auth/presentation/optional-auth.decorator';
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
import { UserDetailDto, UserIdParamDto } from './dto/user-detail.dto';
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

  // ⚠️ **`me` 라우트들보다 반드시 아래**에 선언한다 — `:userId`가 `me`를 삼킨다. 같은
  // 컨트롤러에선 선언 순서가 유일한 방어선이고, 위로 올리면 `GET /users/me`가 조용히
  // "userId가 'me'인 유저 조회"가 되어 400(uuid 아님)이 된다(BlockController가 `me/blocks`를
  // `:userId/block` 위에 둔 것과 같은 규율 — 그쪽은 세그먼트 수가 달라 아직 여유가 있다).
  //
  // 뷰어별 isBlocked가 실리므로 공개(무표시)가 아니라 @OptionalAuth다 — 토큰 없으면 익명
  // 통과(isBlocked: false), 있는데 잘못됐으면 401(만료를 익명으로 조용히 강등하지 않는다).
  @Get(':userId')
  @OptionalAuth()
  // 뷰어별 응답이라 공유 캐시 금지 — 없으면 A의 isBlocked가 B에게 갈 수 있다(post 목록과 동일).
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Authorization')
  @ApiErrors(UserNotFoundError)
  @ZodResponse({
    status: 200,
    description:
      '유저 공개 프로필 — 닉네임·아바타·가입일. 본인 전용 값(provider·email)은 나가지 않는다' +
      '(그건 GET /users/me). 내 id로 호출해도 같은 공개 표현이다. ' +
      '인증 시 isBlocked가 뷰어 기준으로 채워진다(단방향 — 내가 상대를 차단했는지만). ' +
      '**차단한 상대의 프로필도 200이다** — 차단은 목록 필터일 뿐 접근 차단이 아니다. ' +
      '없는 유저·탈퇴한 유저는 404. ' +
      '⚠️ 헤더를 보냈는데 토큰이 만료·손상됐으면 401이다 — 클라의 토큰 갱신 인터셉터가 ' +
      '이 공개 라우트도 커버해야 한다',
    type: UserDetailDto,
  })
  async detail(
    @Param() params: UserIdParamDto,
    @CurrentUser() user: AuthUser | undefined,
  ): Promise<UserDetailDto> {
    const profile = await this.userQuery.findPublicProfile(
      params.userId,
      user?.id,
    );
    // 탈퇴·비존재를 구분하지 않는다 — 밖에서 보면 같은 상태다.
    if (!profile) throw new UserNotFoundError();
    return profile;
  }
}
