import { uuidv7 } from 'uuidv7';
import { PlantCategory } from './plant-category';
import { PLANT_IMAGE_KEY_PREFIX, PlantImage } from './plant-image';
import { InvalidPlantImagesError, InvalidPlantNameError } from './plant.error';

// 불변식 한도 — DTO(Zod 경계)도 이 값을 import해 이중기재 drift를 막는다.
export const PLANT_NAME_MAX_LENGTH = 100;
export const PLANT_IMAGES_MAX = 10;

/**
 * 식물 카탈로그 엔트리 — 공유 자산. 정체성 = 식물명(전역 유니크는 DB 제약 + writer 몫).
 * 자기완결 불변식(이름 형식, 이미지 개수·형식)만 여기서 강제한다(§6).
 */
export class Plant {
  private constructor(
    readonly id: string,
    readonly name: string,
    readonly images: PlantImage[],
    readonly genus: string | null,
    readonly species: string | null,
    readonly category: PlantCategory | null,
    readonly createdById: string,
  ) {}

  static create(params: {
    name: string;
    images: PlantImage[];
    genus?: string | null;
    species?: string | null;
    category?: PlantCategory | null;
    createdById: string;
  }): Plant {
    const name = params.name.trim();
    if (name.length < 1 || name.length > PLANT_NAME_MAX_LENGTH) {
      throw new InvalidPlantNameError();
    }

    const images = params.images;
    if (images.length < 1 || images.length > PLANT_IMAGES_MAX) {
      throw new InvalidPlantImagesError();
    }
    // 자기 purpose 네임스페이스의 업로드만 첨부 가능 — 다른 용도 key 재사용 차단.
    if (images.some((i) => !i.key.startsWith(PLANT_IMAGE_KEY_PREFIX))) {
      throw new InvalidPlantImagesError();
    }
    // 중복 key 금지 — jsonb라 DB 제약으로 못 잡는다.
    if (new Set(images.map((i) => i.key)).size !== images.length) {
      throw new InvalidPlantImagesError();
    }

    return new Plant(
      uuidv7(),
      name,
      images,
      params.genus?.trim() || null,
      params.species?.trim() || null,
      params.category ?? null,
      params.createdById,
    );
  }
}
