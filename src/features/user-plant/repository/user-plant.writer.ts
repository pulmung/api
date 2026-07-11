import { Inject, Injectable } from '@nestjs/common';
import { DatabaseError } from 'pg';
import { DrizzleQueryError } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
import { PG_ERROR_CODE } from '../../../database/postgres-error';
import { userPlants, FK_USER_PLANTS_PLANT } from '../../../database/schema';
import { UserPlant } from '../domain/user-plant';
import { ReferencedPlantNotFoundError } from '../domain/user-plant.error';

@Injectable()
export class UserPlantWriter {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // 응답은 컨트롤러가 재조회(UserPlantQueryService)로 만든다 — writer는 영속화만.
  async create(userPlant: UserPlant): Promise<void> {
    try {
      await this.db.insert(userPlants).values({
        id: userPlant.id,
        ownerId: userPlant.ownerId,
        plantId: userPlant.plantId,
        name: userPlant.name,
        images: userPlant.images,
        adoptedAt: userPlant.adoptedAt,
        memo: userPlant.memo,
      });
    } catch (e) {
      const cause = e instanceof DrizzleQueryError ? e.cause : e;
      // plantId 실존 검증 = 사전 SELECT 대신 FK 위반(23503)을 도메인 예외로 변환
      // (§7의 23505 패턴과 같은 경로 — race-safe + 1쿼리).
      if (
        cause instanceof DatabaseError &&
        cause.code === PG_ERROR_CODE.FOREIGN_KEY_VIOLATION &&
        cause.constraint === FK_USER_PLANTS_PLANT
      ) {
        throw new ReferencedPlantNotFoundError();
      }
      // ownerId FK(23503) 포함 rethrow — 유저 삭제 경로가 아직 없어 도메인 에러로 안 가른다(§7).
      throw e;
    }
  }
}
