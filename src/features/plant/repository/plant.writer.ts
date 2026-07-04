import { Inject, Injectable } from '@nestjs/common';
import { DatabaseError } from 'pg';
import { DrizzleQueryError } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
import { PG_ERROR_CODE } from '../../../database/postgres-error';
import { plants, UNIQUE_PLANTS_NAME } from '../../../database/schema';
import { Plant } from '../domain/plant';
import { PlantNameTakenError } from '../domain/plant.error';

@Injectable()
export class PlantWriter {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // createdAt은 DB(defaultNow)가 생성 → 응답에 필요한 값만 returning으로 받는다(1쿼리).
  async create(plant: Plant): Promise<{ createdAt: Date }> {
    try {
      const [row] = await this.db
        .insert(plants)
        .values({
          id: plant.id,
          name: plant.name,
          images: plant.images,
          genus: plant.genus,
          species: plant.species,
          category: plant.category,
          createdById: plant.createdById,
        })
        .returning({ createdAt: plants.createdAt });
      return row;
    } catch (e) {
      const cause = e instanceof DrizzleQueryError ? e.cause : e;
      if (
        cause instanceof DatabaseError &&
        cause.code === PG_ERROR_CODE.UNIQUE_VIOLATION &&
        cause.constraint === UNIQUE_PLANTS_NAME
      ) {
        throw new PlantNameTakenError();
      }
      // createdById FK(23503) 포함 rethrow — 유저 삭제 경로가 아직 없어 도메인 에러로 안 가른다(§7).
      throw e;
    }
  }
}
