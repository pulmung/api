import { Injectable } from '@nestjs/common';
import { DatabaseError } from 'pg';
import { DrizzleQueryError } from 'drizzle-orm';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { DrizzleDB } from '../../../database/drizzle.constants';
import type { DrizzleTransactionalAdapter } from '../../../database/drizzle-transactional.adapter';
import { PG_ERROR_CODE } from '../../../database/postgres-error';
import { plants, UNIQUE_PLANTS_NAME } from '../../../database/schema';
import { Plant } from '../domain/plant';
import { PlantNameTakenError } from '../domain/plant.error';

@Injectable()
export class PlantWriter {
  constructor(
    private readonly txHost: TransactionHost<DrizzleTransactionalAdapter>,
  ) {}

  // 진행 중인 트랜잭션이 있으면 그 핸들을, 없으면 평범한 db를 준다(CLS가 고른다) —
  // 덕분에 이 어댑터의 쿼리는 트랜잭션 안팎에서 같은 코드로 동작한다.
  private get db(): DrizzleDB {
    return this.txHost.tx;
  }

  // 응답은 컨트롤러가 재조회(PlantReader)로 만든다 — writer는 영속화만.
  async create(plant: Plant): Promise<void> {
    try {
      await this.db.insert(plants).values({
        id: plant.id,
        name: plant.name,
        images: plant.images,
        genus: plant.genus,
        species: plant.species,
        category: plant.category,
        createdById: plant.createdById,
      });
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
