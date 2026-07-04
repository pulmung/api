import { Body, Controller, Post } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { Authenticated } from '../../auth/presentation/authenticated.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth-user';
import { ApiErrors } from '../../../common/swagger/api-errors.decorator';
import { CreatePlantUseCase } from '../application/create-plant.usecase';
import {
  InvalidPlantImagesError,
  InvalidPlantNameError,
  PlantImageNotUploadedError,
  PlantNameTakenError,
} from '../domain/plant.error';
import { CreatePlantDto } from './dto/create-plant.dto';
import { PlantDto } from './dto/plant.dto';

@Controller('plants')
export class PlantController {
  constructor(private readonly createPlant: CreatePlantUseCase) {}

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
    description: '식물 등록 (공유 카탈로그 — 이름 전역 유니크)',
    type: PlantDto,
  })
  async create(@Body() dto: CreatePlantDto, @CurrentUser() user: AuthUser) {
    return this.createPlant.execute({
      name: dto.name,
      images: dto.images,
      genus: dto.genus,
      species: dto.species,
      category: dto.category,
      createdById: user.id,
    });
  }
}
