import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { Authenticated } from '../../auth/presentation/authenticated.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth-user';
import { ApiErrors } from '../../../common/swagger/api-errors.decorator';
import { CreatePlantUseCase } from '../application/create-plant.usecase';
import { PlantQueryService } from '../application/plant-query.service';
import {
  InvalidPlantImagesError,
  InvalidPlantNameError,
  PlantImageNotUploadedError,
  PlantNameTakenError,
  PlantNotFoundError,
} from '../domain/plant.error';
import { CreatePlantDto } from './dto/create-plant.dto';
import { PlantListDto, PlantListQueryDto } from './dto/plant-list.dto';
import { PlantDetailDto, PlantIdParamDto } from './dto/plant-detail.dto';

@Controller('plants')
export class PlantController {
  constructor(
    private readonly createPlant: CreatePlantUseCase,
    private readonly plantQuery: PlantQueryService,
  ) {}

  @Post()
  @Authenticated()
  @ApiErrors(
    PlantNameTakenError,
    PlantImageNotUploadedError,
    InvalidPlantNameError,
    InvalidPlantImagesError,
  )
  @ZodResponse({
    status: 201,
    description:
      '식물 등록 (공유 카탈로그 — 이름 전역 유니크). 응답 = GET /plants/:id와 같은 조회 표현',
    type: PlantDetailDto,
  })
  async create(
    @Body() dto: CreatePlantDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PlantDetailDto> {
    const { id } = await this.createPlant.execute({
      name: dto.name,
      images: dto.images,
      genus: dto.genus,
      species: dto.species,
      category: dto.category,
      createdById: user.id,
    });

    // 생성 201 = 조회 표현(재조회) — 생성/조회 응답의 동일성을 구조로 보장(REST 관례).
    const plant = await this.plantQuery.findById(id);
    // 방금 커밋된 행이라 실패는 불변식 위반 — 404가 아니라 500(unexpected)이 정직하다.
    if (!plant) throw new Error(`created plant not readable: ${id}`);
    return plant;
  }

  // 공개 라우트(무표시, §10) — plants는 공유 카탈로그. 유저 생성 데이터라
  // Cache-Control 없음(admin 큐레이션 사전(genera/species)과 다름).
  @Get()
  @ZodResponse({
    status: 200,
    description: '식물 목록 — 최신순(id DESC) keyset 페이지네이션',
    type: PlantListDto,
  })
  async list(@Query() query: PlantListQueryDto): Promise<PlantListDto> {
    return this.plantQuery.findPage({
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  // ⚠️ 추후 정적 경로(GET /plants/search 등)는 반드시 :id보다 위에 선언 —
  // 아니면 :id로 매칭돼 uuid 검증 400이 난다.
  @Get(':id')
  @ApiErrors(PlantNotFoundError)
  @ZodResponse({ status: 200, description: '식물 상세', type: PlantDetailDto })
  async detail(@Param() params: PlantIdParamDto): Promise<PlantDetailDto> {
    const plant = await this.plantQuery.findById(params.id);
    if (!plant) throw new PlantNotFoundError();
    return plant;
  }
}
