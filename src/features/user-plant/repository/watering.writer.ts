import { Inject, Injectable } from '@nestjs/common';
import { DatabaseError } from 'pg';
import { and, DrizzleQueryError, eq, exists, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
import { PG_ERROR_CODE } from '../../../database/postgres-error';
import {
  userPlants,
  waterings,
  FK_WATERINGS_USER_PLANT,
} from '../../../database/schema';
import { UserPlantNotFoundError } from '../domain/user-plant.error';

@Injectable()
export class WateringWriter {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /**
   * 소유 스코프 INSERT...SELECT — user_plants의 WHERE(id + owner)가 통과한 행에서만
   * 삽입한다. update/delete의 "소유 스코프를 WHERE에" 원칙의 INSERT 버전(race-safe 1쿼리,
   * 사전 SELECT 없음). 같은 날 재기록은 onConflictDoNothing으로 무시된다.
   *
   * @returns 삽입된 id. null = 0행 — 부모 비존재/타인 소유 vs 같은 날 기록 존재(멱등)가
   *          섞여 있으므로 구분은 호출자(usecase)가 재조회로 해소한다.
   */
  async insertIfOwned(params: {
    userPlantId: string;
    wateredOn: string;
    ownerId: string;
  }): Promise<string | null> {
    try {
      const rows = await this.db
        .insert(waterings)
        .select(
          this.db
            // insert-select는 테이블 정의와 같은 필드·같은 순서의 전체 프로젝션을 요구한다
            // (drizzle이 haveSameKeys로 검사) — createdAt까지 명시하는 이유.
            .select({
              // $defaultFn은 values() 경로 전용이라 id를 프로젝션에 명시한다.
              // 상수 프로젝션은 ::uuid/::date 캐스트로 타입을 못 박는다(파라미터 추론 회피).
              id: sql<string>`${uuidv7()}::uuid`.as('id'),
              userPlantId: userPlants.id,
              wateredOn: sql<string>`${params.wateredOn}::date`.as('watered_on'),
              createdAt: sql<Date>`now()`.as('created_at'),
            })
            .from(userPlants)
            .where(
              and(
                eq(userPlants.id, params.userPlantId),
                eq(userPlants.ownerId, params.ownerId),
              ),
            ),
        )
        .onConflictDoNothing({
          target: [waterings.userPlantId, waterings.wateredOn],
        })
        .returning({ id: waterings.id });
      return rows[0]?.id ?? null;
    } catch (e) {
      // 문장 실행 중 부모가 동시 삭제되면 FK 위반 — 비존재와 같은 404로 수렴(§7의 FK 버전).
      const cause = e instanceof DrizzleQueryError ? e.cause : e;
      if (
        cause instanceof DatabaseError &&
        cause.code === PG_ERROR_CODE.FOREIGN_KEY_VIOLATION &&
        cause.constraint === FK_WATERINGS_USER_PLANT
      ) {
        throw new UserPlantNotFoundError();
      }
      throw e;
    }
  }

  /** @returns false = 비존재·타 개체 소속·타인 소유 전부 (구분하지 않는다 — 존재 은닉) */
  async delete(params: {
    wateringId: string;
    userPlantId: string;
    ownerId: string;
  }): Promise<boolean> {
    const rows = await this.db
      .delete(waterings)
      .where(
        and(
          eq(waterings.id, params.wateringId),
          // URL의 계층(개체 → 기록)이 실제 소속과 일치해야 한다 — 남의 개체 경로로
          // 내 기록을 지우는 식의 경로 위조 차단.
          eq(waterings.userPlantId, params.userPlantId),
          exists(
            this.db
              .select({ one: sql`1` })
              .from(userPlants)
              .where(
                and(
                  eq(userPlants.id, params.userPlantId),
                  eq(userPlants.ownerId, params.ownerId),
                ),
              ),
          ),
        ),
      )
      .returning({ id: waterings.id });
    return rows.length > 0;
  }
}
