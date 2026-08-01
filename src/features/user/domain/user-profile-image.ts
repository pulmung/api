import type { FilePurpose } from '../../file/domain/file-purpose';
import { InvalidProfileImageError } from './user.error';

// file feature 키 포맷 `{purpose}/{uuidv7}.{ext}`의 purpose 부분.
// satisfies + type-only import → file domain의 purpose 값과 컴파일 타임 동기화(런타임 결합 0).
export const USER_PROFILE_IMAGE_KEY_PREFIX =
  'user-profile-image/' satisfies `${FilePurpose}/`;

/**
 * 아바타 key 검증 — 자기 purpose 네임스페이스의 업로드만 첨부 가능(plant.ts와 동일 규율).
 *
 * ⚠️ 이 검증의 목적은 "남이 올린 파일 붙이기 차단"이 **아니다** — key가 uuidv7이라 추측
 * 불가하다는 게 files 원장 테이블을 폐기한 근거다(docs/file-upload.md §0). 진짜 목적은
 * **정책 우회 차단**이다: `post-image`(10 MiB)로 presign을 받아 2 MiB 제한인 아바타에
 * 붙이는 경로를 막는 유일한 지점이 여기다(FILE_POLICIES의 purpose별 크기 차등은 발급
 * 시점에만 강제되므로, 첨부 시점엔 prefix가 그 정책의 대리인이다).
 */
export function validateProfileImageKey(raw: string): string {
  const key = raw.trim();
  if (!key.startsWith(USER_PROFILE_IMAGE_KEY_PREFIX)) {
    throw new InvalidProfileImageError();
  }
  return key;
}
