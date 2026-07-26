import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const BlockParamSchema = z.object({
  userId: z.uuid().meta({ description: '차단/해제할 상대 유저 id' }),
});

export class BlockParamDto extends createZodDto(BlockParamSchema) {}

// PUT·DELETE 공용 응답 — 변경 이유가 같다("요청 뒤 이 상대에 대한 내 차단 상태는?").
// PostLikeDto와 같은 결이지만 카운터가 없다(차단은 공개 수치가 아니다 — 상대에게
// "몇 명이 나를 차단했나"를 알려줄 이유가 없고, 그래서 비정규화 컬럼도 없다).
const BlockSchema = z.object({
  blocked: z.boolean().meta({
    description:
      '요청 후 내 차단 상태 — PUT이면 항상 true, DELETE면 항상 false(멱등이라 이전 상태와 무관)',
  }),
});

export class BlockDto extends createZodDto(BlockSchema) {}
