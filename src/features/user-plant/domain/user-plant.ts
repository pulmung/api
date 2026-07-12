import { uuidv7 } from 'uuidv7';
import type { PlantImage } from '../../plant/domain/plant-image';
import { USER_PLANT_IMAGE_KEY_PREFIX } from './user-plant-image';
import {
  InvalidUserPlantImagesError,
  InvalidUserPlantNameError,
} from './user-plant.error';

// 불변식 한도 — DTO(Zod 경계)도 이 값을 import해 이중기재 drift를 막는다.
export const USER_PLANT_NAME_MAX_LENGTH = 100;
export const USER_PLANT_IMAGES_MAX = 10;

// module-private — UserPlant.create(등록)와 UserPlantPatch.create(수정)가 같은 불변식을 공유한다.
function validateName(raw: string): string {
  const name = raw.trim();
  if (name.length < 1 || name.length > USER_PLANT_NAME_MAX_LENGTH) {
    throw new InvalidUserPlantNameError();
  }
  return name;
}

function validateImages(images: PlantImage[]): PlantImage[] {
  // 카탈로그(≥1)와 달리 최소 개수 없음 — 사진 없이도 등록 가능해야 마찰이 낮다.
  if (images.length > USER_PLANT_IMAGES_MAX) {
    throw new InvalidUserPlantImagesError();
  }
  // 자기 purpose 네임스페이스의 업로드만 첨부 가능 — 다른 용도 key 재사용 차단.
  if (images.some((i) => !i.key.startsWith(USER_PLANT_IMAGE_KEY_PREFIX))) {
    throw new InvalidUserPlantImagesError();
  }
  // 중복 key 금지 — jsonb라 DB 제약으로 못 잡는다.
  if (new Set(images.map((i) => i.key)).size !== images.length) {
    throw new InvalidUserPlantImagesError();
  }
  return images;
}

/**
 * 내 식물 — 유저가 실제로 키우는 개체(individual). 카탈로그(Plant)가 "종/품종"이라면
 * 이건 "우리 집 몬스테라 한 그루"다. 소유자 검증(내 것만 수정/삭제)은 컨텍스트 의존
 * 규칙이라 여기가 아니라 application/repository 몫(§6).
 */
export class UserPlant {
  private constructor(
    readonly id: string,
    readonly ownerId: string,
    readonly plantId: string | null,
    readonly name: string,
    readonly images: PlantImage[],
    readonly adoptedAt: string | null,
    readonly memo: string | null,
  ) {}

  static create(params: {
    ownerId: string;
    name: string;
    images: PlantImage[];
    plantId?: string | null;
    adoptedAt?: string | null;
    memo?: string | null;
  }): UserPlant {
    return new UserPlant(
      uuidv7(),
      params.ownerId,
      // 카탈로그 참조는 옵셔널("무슨 식물인지 모름"은 정당한 상태) — 실존 검증은
      // uuid 형식(DTO)·FK 23503(writer) 몫이라 여기선 passthrough.
      params.plantId ?? null,
      validateName(params.name),
      validateImages(params.images),
      // 'YYYY-MM-DD' 형식 검증은 DTO(z.iso.date()) 몫. 미래 날짜는 막지 않는다 —
      // 서버가 유저의 "오늘"(타임존)을 모르므로 오탐이 생기고, 허용해도 해가 없다.
      params.adoptedAt ?? null,
      params.memo?.trim() || null,
    );
  }
}

/**
 * 부분 수정 커맨드 (JSON Merge Patch, RFC 7396): undefined = 미변경, null = 해제, 값 = 교체.
 * images는 전체 교체 배열([] = 모두 제거), name은 notnull 컬럼이라 null 불가(타입으로 차단).
 * ⚠️ create와 undefined의 의미가 다르다 — create는 "생략 = 비움(null)"이지만 patch는
 * "생략 = 미변경"이라, 제공된 필드만 검증/변환하고 undefined는 그대로 통과시킨다
 * (예: create의 `memo?.trim() || null`을 그대로 쓰면 memo 없는 패치마다 memo가 지워진다).
 * "빈 패치 거부"는 도메인 불변식이 아니라 HTTP 관심사 → DTO(.refine 400) 몫.
 */
export class UserPlantPatch {
  private constructor(
    readonly name: string | undefined,
    readonly plantId: string | null | undefined,
    readonly images: PlantImage[] | undefined,
    readonly adoptedAt: string | null | undefined,
    readonly memo: string | null | undefined,
  ) {}

  static create(params: {
    name?: string;
    plantId?: string | null;
    images?: PlantImage[];
    adoptedAt?: string | null;
    memo?: string | null;
  }): UserPlantPatch {
    return new UserPlantPatch(
      params.name === undefined ? undefined : validateName(params.name),
      params.plantId,
      params.images === undefined ? undefined : validateImages(params.images),
      params.adoptedAt,
      params.memo === undefined ? undefined : params.memo?.trim() || null,
    );
  }
}
