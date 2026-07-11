import { Body, Controller, Post } from '@nestjs/common';
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
} from '../domain/user-plant.error';
import { CreateUserPlantDto } from './dto/create-user-plant.dto';
import { UserPlantDetailDto } from './dto/user-plant-detail.dto';

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
      '내 식물 등록 (유저 소유 개체 — 카탈로그 연결은 옵셔널). 응답 = 추후 GET /user-plants/:id와 같은 조회 표현',
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
    const userPlant = await this.userPlantQuery.findById(id);
    // 방금 커밋된 행이라 실패는 불변식 위반 — 404가 아니라 500(unexpected)이 정직하다.
    if (!userPlant) throw new Error(`created user plant not readable: ${id}`);
    return userPlant;
  }
}
