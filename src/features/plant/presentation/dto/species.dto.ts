import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const SpeciesQuerySchema = z.object({
  genus: z.string().trim().min(1).max(100).meta({
    description: '속 이름(정확 일치 필터) — 미등록 속이면 빈 배열',
    example: '몬스테라',
  }),
});

export class SpeciesQueryDto extends createZodDto(SpeciesQuerySchema) {}

const SpeciesSchema = z.object({
  species: z.array(z.string()).meta({ example: ['델리시오사', '아단소니'] }),
});

export class SpeciesDto extends createZodDto(SpeciesSchema) {}
