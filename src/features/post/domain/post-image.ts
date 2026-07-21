import type { FilePurpose } from '../../file/domain/file-purpose';

// file feature 키 포맷 `{purpose}/{uuidv7}.{ext}`의 purpose 부분.
// satisfies + type-only import → file domain의 purpose 값과 컴파일 타임 동기화(런타임 결합 0).
export const POST_IMAGE_KEY_PREFIX = 'post-image/' satisfies `${FilePurpose}/`;
