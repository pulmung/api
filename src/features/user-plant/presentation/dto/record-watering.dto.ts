import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const RecordWateringSchema = z.object({
  // 필수 — 서버 기본값("오늘") 없음: 서버는 유저의 타임존을 몰라 "유저에게 오늘"을
  // 계산할 수 없다. 클라가 자기 로컬 달력 날짜를 보낸다(adoptedAt과 동일 논리).
  // 과거 backfill·미래 날짜도 같은 이유로 막지 않는다.
  wateredOn: z.iso.date().meta({
    description:
      '물 준 날 — 유저 로컬 달력 날짜(클라가 계산). 같은 개체·같은 날 재기록은 멱등 201(기존 기록 반환)',
    example: '2026-07-18',
  }),
});

export class RecordWateringDto extends createZodDto(RecordWateringSchema) {}
