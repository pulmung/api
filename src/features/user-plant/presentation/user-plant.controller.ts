import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { Authenticated } from '../../auth/presentation/authenticated.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth-user';
import { ApiErrors } from '../../../common/swagger/api-errors.decorator';
import { CreateUserPlantUseCase } from '../application/create-user-plant.usecase';
import { UserPlantQueryService } from '../application/user-plant-query.service';
import {
  InvalidUserPlantImagesError,
  InvalidUserPlantNameError,
  ReferencedPlantNotFoundError,
  UserPlantImageNotUploadedError,
  UserPlantNotFoundError,
} from '../domain/user-plant.error';
import { CreateUserPlantDto } from './dto/create-user-plant.dto';
import {
  UserPlantDetailDto,
  UserPlantIdParamDto,
} from './dto/user-plant-detail.dto';
import {
  UserPlantListDto,
  UserPlantListQueryDto,
} from './dto/user-plant-list.dto';

@Controller('user-plants')
export class UserPlantController {
  constructor(
    private readonly createUserPlant: CreateUserPlantUseCase,
    private readonly userPlantQuery: UserPlantQueryService,
  ) {}

  @Post()
  @Authenticated()
  @ApiErrors(
    ReferencedPlantNotFoundError,
    UserPlantImageNotUploadedError,
    InvalidUserPlantNameError,
    InvalidUserPlantImagesError,
  )
  @ZodResponse({
    status: 201,
    description:
      '내 식물 등록 (유저 소유 개체 — 카탈로그 연결은 옵셔널). 응답 = GET /user-plants/:id와 같은 조회 표현',
    type: UserPlantDetailDto,
  })
  async create(
    @Body() dto: CreateUserPlantDto,
    @CurrentUser() user: AuthUser,
  ): Promise<UserPlantDetailDto> {
    const { id } = await this.createUserPlant.execute({
      ownerId: user.id,
      name: dto.name,
      images: dto.images,
      plantId: dto.plantId,
      adoptedAt: dto.adoptedAt,
      memo: dto.memo,
    });

    // 생성 201 = 조회 표현(재조회) — 생성/조회 응답의 동일성을 구조로 보장(REST 관례).
    const userPlant = await this.userPlantQuery.findById(id, user.id);
    // 방금 커밋된 행이라 실패는 불변식 위반 — 404가 아니라 500(unexpected)이 정직하다.
    if (!userPlant) throw new Error(`created user plant not readable: ${id}`);
    return userPlant;
  }

  @Get()
  @Authenticated()
  @ZodResponse({
    status: 200,
    description: '내 식물 목록 — 최신순(id DESC) keyset 페이지네이션',
    type: UserPlantListDto,
  })
  async list(
    @Query() query: UserPlantListQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<UserPlantListDto> {
    return this.userPlantQuery.findPage({
      ownerId: user.id,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get(':id')
  @Authenticated()
  @ApiErrors(UserPlantNotFoundError)
  @ZodResponse({
    status: 200,
    description: '내 식물 상세 — 타인 소유는 비존재와 동일하게 404(존재 은닉)',
    type: UserPlantDetailDto,
  })
  async detail(
    @Param() params: UserPlantIdParamDto,
    @CurrentUser() user: AuthUser,
  ): Promise<UserPlantDetailDto> {
    const userPlant = await this.userPlantQuery.findById(params.id, user.id);
    if (!userPlant) throw new UserPlantNotFoundError();
    return userPlant;
  }
}
