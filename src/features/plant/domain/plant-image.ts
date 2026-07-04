import type { FilePurpose } from '../../file/domain/file-purpose';

// file feature 키 포맷 `{purpose}/{uuidv7}.{ext}`의 purpose 부분.
// satisfies + type-only import → file domain의 purpose 값과 컴파일 타임 동기화(런타임 결합 0).
export const PLANT_IMAGE_KEY_PREFIX = 'plant-image/' satisfies `${FilePurpose}/`;

// width/height는 클라 제공 힌트(신뢰 불가, 피드 CLS 방지용) — docs/file-upload.md §6.
// 서버는 형식만 받고 검증하지 않는다(진짜 치수는 추후 S3 이벤트→Lambda seam).
export type PlantImage = {
  key: string;
  width?: number;
  height?: number;
};
