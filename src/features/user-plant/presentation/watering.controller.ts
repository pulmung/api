import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiNoContentResponse } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { Authenticated } from '../../auth/presentation/authenticated.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth-user';
import { ApiErrors } from '../../../common/swagger/api-errors.decorator';
import { RecordWateringUseCase } from '../application/record-watering.usecase';
import { DeleteWateringUseCase } from '../application/delete-watering.usecase';
import { UserPlantReader } from '../repository/user-plant.reader';
import { WateringReader } from '../repository/watering.reader';
import { UserPlantNotFoundError } from '../domain/user-plant.error';
import { WateringNotFoundError } from '../domain/watering.error';
import { RecordWateringDto } from './dto/record-watering.dto';
import { WateringDto } from './dto/watering.schema';
import { WateringIdParamDto } from './dto/delete-watering.dto';
import { UserPlantIdParamDto } from './dto/user-plant-detail.dto';
import { WateringListDto, WateringListQueryDto } from './dto/watering-list.dto';

// 물주기 기록 — 내 식물(개체)의 하위 리소스. 개체 라우트와 분리된 컨트롤러(파일 작게).
@Controller('user-plants/:id/waterings')
export class WateringController {
  constructor(
    private readonly recordWatering: RecordWateringUseCase,
    private readonly deleteWatering: DeleteWateringUseCase,
    private readonly userPlantReader: UserPlantReader,
    private readonly wateringReader: WateringReader,
  ) {}

  @Post()
  @Authenticated()
  @ApiErrors(UserPlantNotFoundError)
  @ZodResponse({
    status: 201,
    description:
      '물주기 기록. 같은 개체·같은 날 재기록은 기존 기록으로 동일 201(멱등 — 더블탭 안전). 타인/비존재 개체는 404(존재 은닉)',
    type: WateringDto,
  })
  async record(
    @Param() params: UserPlantIdParamDto,
    @Body() dto: RecordWateringDto,
    @CurrentUser() user: AuthUser,
  ): Promise<WateringDto> {
    const { id } = await this.recordWatering.execute({
      ownerId: user.id,
      userPlantId: params.id,
      wateredOn: dto.wateredOn,
    });
    // 재조회 생략 — 조회 표현이 {id, wateredOn} 뿐이라(둘 다 이미 손에 있다) 재조회가
    // 막아줄 생성/조회 이원화가 없다(§0 — 개체 라우트의 재조회 관례와 의도된 편차).
    return { id, wateredOn: dto.wateredOn };
  }

  @Get()
  @Authenticated()
  @ApiErrors(UserPlantNotFoundError)
  @ZodResponse({
    status: 200,
    description:
      '물주기 이력 — 최신순(wateredOn DESC) keyset 페이지네이션. 타인/비존재 개체는 404(존재 은닉)',
    type: WateringListDto,
  })
  async list(
    @Param() params: UserPlantIdParamDto,
    @Query() query: WateringListQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<WateringListDto> {
    // 조합 0(문자열 2필드 passthrough) → reader 직행(§2). envelope 조립(limit+1
    // 슬라이스)은 species 목록처럼 컨트롤러 몫.
    const rows = await this.wateringReader.findPageRows({
      userPlantId: params.id,
      ownerId: user.id,
      cursor: query.cursor,
      limit: query.limit,
    });
    // 페이지 쿼리의 0행은 "빈 이력"과 "타인/비존재 개체"가 겹친다 — 그때만 존재 확인.
    if (rows.length === 0) {
      const owned = await this.userPlantReader.exists(params.id, user.id);
      if (!owned) throw new UserPlantNotFoundError();
    }
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      waterings: page,
      nextCursor: hasMore ? page[page.length - 1].wateredOn : null,
    };
  }

  @Delete(':wateringId')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiErrors(WateringNotFoundError)
  @ApiNoContentResponse({
    description:
      '물주기 기록 삭제 (잘못 기록한 날 지우기) — 비존재·타 개체 소속·타인 소유 모두 404(존재 은닉)',
  })
  async remove(
    @Param() params: WateringIdParamDto,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.deleteWatering.execute({
      wateringId: params.wateringId,
      userPlantId: params.id,
      ownerId: user.id,
    });
  }
}
