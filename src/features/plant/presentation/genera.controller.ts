import { Controller, Get, Header } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { PlantDictionaryReader } from '../repository/plant-dictionary.reader';
import { GeneraDto } from './dto/genera.dto';

@Controller('genera')
export class GeneraController {
  constructor(private readonly dictionary: PlantDictionaryReader) {}

  // 공개 라우트(무표시, §10). 사전 데이터 — 저빈도 변경이라 캐시 허용.
  @Get()
  @Header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
  @ZodResponse({
    status: 200,
    description: '속(genus) 사전 — 식물 등록 셀렉트박스 선택지 (이름 가나다순)',
    type: GeneraDto,
  })
  async list(): Promise<GeneraDto> {
    return { genera: await this.dictionary.findGenusNames() };
  }
}
