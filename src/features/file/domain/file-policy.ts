import { FilePurpose } from './file-purpose';

// contentType → 확장자. 서비스 전체 허용 타입의 단일 소스.
// HEIC 제외(결정): 서버 변환 파이프라인이 없으므로 클라이언트가 업로드 전 JPEG/WebP로 변환한다.
export const CONTENT_TYPE_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export type AllowedContentType = keyof typeof CONTENT_TYPE_EXT;

// purpose별 업로드 정책 — presign 조건(content-length-range, Content-Type)의 단일 소스.
// allowedContentTypes 가 AllowedContentType[] 이므로 "허용 타입엔 반드시 ext 매핑 존재"가 컴파일 타임 보장.
export const FILE_POLICIES: Record<
  FilePurpose,
  {
    allowedContentTypes: readonly AllowedContentType[];
    maxSizeBytes: number;
  }
> = {
  'plant-image': {
    allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxSizeBytes: 10 * 1024 * 1024, // 10 MiB
  },
  // 카탈로그와 정책이 같아도 purpose는 분리 — key에 prefix가 박혀 저장되므로
  // 나중에 나누려면 키 마이그레이션이 필요하다. 지금 나누면 정책 독립이 공짜.
  'user-plant-image': {
    allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxSizeBytes: 10 * 1024 * 1024, // 10 MiB
  },
};
