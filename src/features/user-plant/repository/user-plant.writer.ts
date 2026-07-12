import { Inject, Injectable } from '@nestjs/common';
import { DatabaseError } from 'pg';
import { and, DrizzleQueryError, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
import { PG_ERROR_CODE } from '../../../database/postgres-error';
import {
  userPlants,
  FK_USER_PLANTS_PLANT,
  type NewUserPlant,
} from '../../../database/schema';
import { UserPlant, UserPlantPatch } from '../domain/user-plant';
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
      this.throwIfReferencedPlantMissing(e);
      // ownerId FK(23503) 포함 rethrow — 유저 삭제 경로가 아직 없어 도메인 에러로 안 가른다(§7).
      throw e;
    }
  }

  /** @returns false = 비존재 또는 타인 소유 (구분하지 않는다 — 존재 은닉) */
  async update(
    id: string,
    ownerId: string,
    patch: UserPlantPatch,
  ): Promise<boolean> {
    // undefined 필드는 SET에서 제외 = 컬럼을 건드리지 않는다(merge-patch).
    // drizzle이 내부적으로 undefined를 걸러주지만 ORM 내부 동작에 안 기댄다(명시 > 마법).
    const set: Partial<NewUserPlant> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.plantId !== undefined) set.plantId = patch.plantId;
    if (patch.images !== undefined) set.images = patch.images;
    if (patch.adoptedAt !== undefined) set.adoptedAt = patch.adoptedAt;
    if (patch.memo !== undefined) set.memo = patch.memo;
    // updatedAt은 스키마 $onUpdate가 UPDATE마다 자동으로 SET에 붙인다 — 명시 불필요.

    try {
      // 소유 스코프를 WHERE에 — race-safe 1쿼리. RETURNING id로 0행(=404) 감지
      // (pg rowCount는 number|null 타입 워트가 있어 returning이 더 깔끔하다).
      // 0행이면 FK가 평가되지 않으므로 404가 422보다 자연히 우선한다.
      const rows = await this.db
        .update(userPlants)
        .set(set)
        .where(and(eq(userPlants.id, id), eq(userPlants.ownerId, ownerId)))
        .returning({ id: userPlants.id });
      return rows.length > 0;
    } catch (e) {
      this.throwIfReferencedPlantMissing(e);
      throw e;
    }
  }

  /** @returns false = 비존재 또는 타인 소유. S3 객체는 안 지운다(orphan 허용 — docs/file-upload.md) */
  async delete(id: string, ownerId: string): Promise<boolean> {
    const rows = await this.db
      .delete(userPlants)
      .where(and(eq(userPlants.id, id), eq(userPlants.ownerId, ownerId)))
      .returning({ id: userPlants.id });
    return rows.length > 0;
  }

  // plantId 실존 검증 = 사전 SELECT 대신 FK 위반(23503)을 도메인 예외로 변환
  // (§7의 23505 패턴과 같은 경로 — race-safe + 1쿼리). 매치 안 되면 조용히 반환(호출부가 rethrow).
  private throwIfReferencedPlantMissing(e: unknown): void {
    const cause = e instanceof DrizzleQueryError ? e.cause : e;
    if (
      cause instanceof DatabaseError &&
      cause.code === PG_ERROR_CODE.FOREIGN_KEY_VIOLATION &&
      cause.constraint === FK_USER_PLANTS_PLANT
    ) {
      throw new ReferencedPlantNotFoundError();
    }
  }
}
