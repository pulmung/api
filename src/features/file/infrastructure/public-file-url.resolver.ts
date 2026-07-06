import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../../config/env.validation';

// 읽기 URL 어댑터 — 업로드(S3FileStorage)와 변경 이유가 다르다(docs/file-upload.md §5:
// "읽기(다운로드)는 별도 어댑터"). CDN/버킷 이전 시 여기 한 곳만 바뀐다.
// seam: private 파일(채팅)의 CloudFront signed URL 발급도 이 축에서 확장.
@Injectable()
export class PublicFileUrlResolver {
  private readonly baseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get('PUBLIC_FILE_BASE_URL', { infer: true });
  }

  // 저장은 불투명 key만(전체 URL 금지 — docs/file-upload.md §6) → 응답 시점에 조합.
  resolve(key: string): string {
    return `${this.baseUrl}/${key}`;
  }
}
