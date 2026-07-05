import { DrizzleDB } from '../drizzle.constants';
import { genera, species } from '../schema';
import type { PlantDictionaryData } from './plant-dictionary.data';

export interface SeedResult {
  generaInserted: number;
  generaSkipped: number;
  speciesInserted: number;
  speciesSkipped: number;
}

// 사전 시드 — insert-only 멱등 베이스라인.
// · 재실행 = 누락분만 추가(onConflictDoNothing). update/delete는 하지 않는다 —
//   admin이 나중에 이 테이블을 공동 소유하므로 시드가 admin 수정을 덮으면 안 된다.
// · ⚠️ 캐비앳: admin이 지운 baseline 행은 재시드 시 부활한다. admin 도입 전까지
//   수용(구분하려면 managed_by 마커가 필요 — YAGNI).
// · 원자성: 함수가 자기 트랜잭션을 소유한다(호출자 규율에 의존하지 않음).
// · 카운트는 rowCount — ON CONFLICT DO NOTHING에서 실제 삽입된 행 수만 센다.
export async function seedPlantDictionary(
  db: DrizzleDB,
  data: PlantDictionaryData,
): Promise<SeedResult> {
  // 검증 먼저, 삽입 전에 throw — 데이터는 코드이므로 정규화(trim)하지 않고 거부한다.
  validate(data);

  const generaValues = Object.keys(data).map((name) => ({ name }));
  // FK(species.genus → genera.name) 때문에 genera를 먼저 넣는다.
  const speciesValues = Object.entries(data).flatMap(([genus, names]) =>
    names.map((name) => ({ genus, name })),
  );

  return db.transaction(async (tx) => {
    let generaInserted = 0;
    let speciesInserted = 0;

    // rc.3의 values([])는 throw → 빈 배치 가드.
    if (generaValues.length > 0) {
      const result = await tx
        .insert(genera)
        .values(generaValues)
        .onConflictDoNothing();
      generaInserted = result.rowCount ?? 0;
    }
    if (speciesValues.length > 0) {
      const result = await tx
        .insert(species)
        .values(speciesValues)
        .onConflictDoNothing();
      speciesInserted = result.rowCount ?? 0;
    }

    return {
      generaInserted,
      generaSkipped: generaValues.length - generaInserted,
      speciesInserted,
      speciesSkipped: speciesValues.length - speciesInserted,
    };
  });
}

function validate(data: PlantDictionaryData): void {
  for (const [genus, speciesNames] of Object.entries(data)) {
    assertValidName(genus, `속 "${genus}"`);
    const seen = new Set<string>();
    for (const name of speciesNames) {
      assertValidName(name, `속 "${genus}"의 종 "${name}"`);
      if (seen.has(name)) {
        throw new Error(`시드 데이터 오류: 속 "${genus}"에 종 "${name}"이 중복됨`);
      }
      seen.add(name);
    }
  }
}

function assertValidName(name: string, label: string): void {
  if (name.length === 0 || name !== name.trim()) {
    throw new Error(`시드 데이터 오류: ${label} — 빈 이름이거나 앞뒤 공백 포함`);
  }
}
