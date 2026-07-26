import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// 물주기 기록의 조회 표현 — POST 201과 목록 배열이 공유한다(변경 이유 동일, §9).
// named component 단일 인스턴스(.meta id) — 복제 시 duplicate-id 충돌(§9).
export const WateringSchema = z
  .object({
    id: z.uuid(),
    wateredOn: z.iso.date().meta({
      description: '물 준 날 (유저 로컬 달력 날짜)',
      example: '2026-07-18',
    }),
  })
  .meta({ id: 'Watering' });

export class WateringDto extends createZodDto(WateringSchema) {}
