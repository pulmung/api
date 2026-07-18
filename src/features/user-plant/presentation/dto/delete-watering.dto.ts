import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// DELETE :wateringId 전용 — 컨트롤러 경로의 :id(개체)와 메서드 경로의 :wateringId가
// 한 params 객체로 머지되므로 둘 다 검증한다.
const WateringIdParamSchema = z.object({
  id: z.uuid().meta({ description: '내 식물(개체) id' }),
  wateringId: z.uuid().meta({ description: '물주기 기록 id' }),
});

export class WateringIdParamDto extends createZodDto(WateringIdParamSchema) {}
