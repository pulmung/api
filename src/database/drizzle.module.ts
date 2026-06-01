import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DRIZZLE } from './drizzle.constants';
import { Env } from '../config/env.validation';

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Env, true>) => {
        const pool = new Pool({
          connectionString: configService.get('DATABASE_URL', { infer: true }),
        });
        // v1.0: (client, config) 오버로드 제거 → 단일 객체형. casing은 테이블 팩토리(schema/table.ts)에 주입.
        return drizzle({ client: pool });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DrizzleModule {}
