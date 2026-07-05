import { Controller, Get, Header, Query } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { PlantDictionaryReader } from '../repository/plant-dictionary.reader';
import { SpeciesDto, SpeciesQueryDto } from './dto/species.dto';

@Controller('species')
export class SpeciesController {
  constructor(private readonly dictionary: PlantDictionaryReader) {}

  // 공개 라우트(무표시, §10). genus는 필터(exact match) — 미등록 속은 404가 아니라 빈 배열.
  @Get()
  @Header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
  @ZodResponse({
    status: 200,
    description: '종(species) 사전 — 선택한 속의 종만 (이름 가나다순, 미등록 속은 빈 배열)',
    type: SpeciesDto,
  })
  async list(@Query() query: SpeciesQueryDto): Promise<SpeciesDto> {
    return { species: await this.dictionary.findSpeciesNames(query.genus) };
  }
}
