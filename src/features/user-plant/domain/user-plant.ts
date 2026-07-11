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
    const name = params.name.trim();
    if (name.length < 1 || name.length > USER_PLANT_NAME_MAX_LENGTH) {
      throw new InvalidUserPlantNameError();
    }

    const images = params.images;
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

    return new UserPlant(
      uuidv7(),
      params.ownerId,
      // 카탈로그 참조는 옵셔널("무슨 식물인지 모름"은 정당한 상태) — 실존 검증은
      // uuid 형식(DTO)·FK 23503(writer) 몫이라 여기선 passthrough.
      params.plantId ?? null,
      name,
      images,
      // 'YYYY-MM-DD' 형식 검증은 DTO(z.iso.date()) 몫. 미래 날짜는 막지 않는다 —
      // 서버가 유저의 "오늘"(타임존)을 모르므로 오탐이 생기고, 허용해도 해가 없다.
      params.adoptedAt ?? null,
      params.memo?.trim() || null,
    );
  }
}
