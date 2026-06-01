import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/database/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // v1.0: drizzle-kit의 casing은 'camel'|'preserve'(pull 전용)로 의미가 바뀜.
  // snake_case 변환은 스키마의 테이블 팩토리(schema/table.ts)가 담당하므로 여기선 생략한다.
  verbose: true,
  strict: true,
});
