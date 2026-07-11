import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
import { plants, userPlants } from '../../../database/schema';

// 내 식물 read model의 원천 행 — 부분 select. 새 컬럼은 여기 명시적으로 추가해야
// 읽기 경로에 들어온다(옵트인). ownerId는 응답에 안 나가므로 제외(요청자 = 소유자).
const USER_PLANT_ROW = {
  id: userPlants.id,
  name: userPlants.name,
  images: userPlants.images,
  adoptedAt: userPlants.adoptedAt,
  memo: userPlants.memo,
  createdAt: userPlants.createdAt,
  // 연결된 카탈로그 요약 — 중첩 셀렉션은 left join 미매칭 시 drizzle이 객체 전체를
  // null로 접는다(타입·런타임 모두) → plant: {…} | null 이 그대로 read model이 된다.
  plant: { id: plants.id, name: plants.name },
};

// 읽기 어댑터 — 순수 DB 접근. plants 테이블 직접 join은 모듈 경계 위반이 아니라
// CQRS 읽기의 정상 경로다(read model은 테이블을 횡단한다) — PlantModule 경유(추가
// 쿼리)는 순수성 의례일 뿐. 쓰기 쪽 결합은 이미 FK가 DB 레벨에서 갖고 있다.
@Injectable()
export class UserPlantReader {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findById(id: string) {
    const [row] = await this.db
      .select(USER_PLANT_ROW)
      .from(userPlants)
      .leftJoin(plants, eq(userPlants.plantId, plants.id))
      .where(eq(userPlants.id, id));
    return row ?? null;
  }
}
