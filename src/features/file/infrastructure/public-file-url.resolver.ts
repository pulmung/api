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

  // resolve의 역 — 우리 도메인의 URL이면 key, 아니면 null. 게시글 본문(<img src>)처럼
  // URL 형태로 돌아오는 입력에서 key를 복원할 때 쓴다. URL↔key 매핑(정·역)을 이 클래스에
  // 단일 소스로 가둬, base URL이 바뀌어도 역매핑이 조용히 어긋나지 않게 한다.
  tryParseKey(url: string): string | null {
    const prefix = `${this.baseUrl}/`;
    if (!url.startsWith(prefix)) return null;
    const key = url.slice(prefix.length);
    return key.length > 0 ? key : null;
  }
}
