import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const GeneraSchema = z.object({
  genera: z.array(z.string()).meta({ example: ['몬스테라', '필로덴드론'] }),
});

export class GeneraDto extends createZodDto(GeneraSchema) {}
