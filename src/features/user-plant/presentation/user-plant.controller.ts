import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiNoContentResponse } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { Authenticated } from '../../auth/presentation/authenticated.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth-user';
import { ApiErrors } from '../../../common/swagger/api-errors.decorator';
import { CreateUserPlantUseCase } from '../application/create-user-plant.usecase';
import { UpdateUserPlantUseCase } from '../application/update-user-plant.usecase';
import { DeleteUserPlantUseCase } from '../application/delete-user-plant.usecase';
import { UserPlantQueryService } from '../application/user-plant-query.service';
import {
  InvalidUserPlantImagesError,
  InvalidUserPlantNameError,
  InvalidWateringIntervalError,
  ReferencedPlantNotFoundError,
  UserPlantImageNotUploadedError,
  UserPlantNotFoundError,
} from '../domain/user-plant.error';
import { CreateUserPlantDto } from './dto/create-user-plant.dto';
import { UpdateUserPlantDto } from './dto/update-user-plant.dto';
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
    private readonly updateUserPlant: UpdateUserPlantUseCase,
    private readonly deleteUserPlant: DeleteUserPlantUseCase,
    private readonly userPlantQuery: UserPlantQueryService,
  ) {}

  @Post()
  @Authenticated()
  @ApiErrors(
    ReferencedPlantNotFoundError,
    UserPlantImageNotUploadedError,
    InvalidUserPlantNameError,
    InvalidUserPlantImagesError,
    InvalidWateringIntervalError,
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
      wateringIntervalDays: dto.wateringIntervalDays,
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

  @Patch(':id')
  @Authenticated()
  @ApiErrors(
    UserPlantNotFoundError,
    ReferencedPlantNotFoundError,
    UserPlantImageNotUploadedError,
    InvalidUserPlantNameError,
    InvalidUserPlantImagesError,
    InvalidWateringIntervalError,
  )
  @ZodResponse({
    status: 200,
    description:
      '내 식물 부분 수정 (JSON Merge Patch: 필드 부재 = 미변경, null = 해제, images = 전체 교체). 응답 = 조회 표현',
    type: UserPlantDetailDto,
  })
  async update(
    @Param() params: UserPlantIdParamDto,
    @Body() dto: UpdateUserPlantDto,
    @CurrentUser() user: AuthUser,
  ): Promise<UserPlantDetailDto> {
    await this.updateUserPlant.execute({
      id: params.id,
      ownerId: user.id,
      name: dto.name,
      plantId: dto.plantId,
      images: dto.images,
      adoptedAt: dto.adoptedAt,
      memo: dto.memo,
      wateringIntervalDays: dto.wateringIntervalDays,
    });

    // 수정 200 = 조회 표현(재조회) — POST 201과 동일 패턴, 수정/조회 응답의 동일성을 구조로 보장.
    const userPlant = await this.userPlantQuery.findById(params.id, user.id);
    // 방금 수정한 행이라 실패는 불변식 위반 — 404가 아니라 500(unexpected)이 정직하다.
    if (!userPlant) throw new Error(`updated user plant not readable: ${params.id}`);
    return userPlant;
  }

  @Delete(':id')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiErrors(UserPlantNotFoundError)
  // ZodResponse는 zod DTO가 필수라 본문 없는 204엔 못 쓴다 — swagger 데코 직접 사용
  // (ApiErrors가 ApiResponse를 직접 쓰는 것과 같은 결). 직렬화 인터셉터는 메타데이터 없으면 통과.
  @ApiNoContentResponse({
    description:
      '내 식물 삭제 (hard delete) — S3 이미지 객체는 지우지 않는다(orphan 허용, docs/file-upload.md). 타인 소유는 404(존재 은닉)',
  })
  async remove(
    @Param() params: UserPlantIdParamDto,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.deleteUserPlant.execute({ id: params.id, ownerId: user.id });
  }
}
