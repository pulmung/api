import type { FilePurpose } from '../../file/domain/file-purpose';

// file feature 키 포맷 `{purpose}/{uuidv7}.{ext}`의 purpose 부분.
// satisfies + type-only import → file domain의 purpose 값과 컴파일 타임 동기화(런타임 결합 0).
// 이미지 형태 자체({key, width?, height?})는 plant 도메인의 PlantImage를 재사용한다 —
// 스키마 jsonb($type)가 이미 그 타입이고, 형태가 같은 별도 타입은 drift만 만든다.
export const USER_PLANT_IMAGE_KEY_PREFIX =
  'user-plant-image/' satisfies `${FilePurpose}/`;
