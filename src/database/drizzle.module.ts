import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DRIZZLE } from './drizzle.constants';
import * as schema from './schema';
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
        return drizzle(pool, { schema, casing: 'snake_case' });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DrizzleModule {}
