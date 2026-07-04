import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HeadObjectCommand, NotFound, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { Env } from '../../../config/env.validation';

// presign 유효기간 — 서명 전송 보안 파라미터(도메인 정책 아님)라 어댑터가 소유.
// purpose별 차등이 필요해지면 그때 FILE_POLICIES로 이동(YAGNI).
const UPLOAD_EXPIRES_SECONDS = 300;

@Injectable()
export class S3FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService<Env, true>) {
    // credentials 생략 → default credential chain (prod IAM role / 로컬 profile)
    this.client = new S3Client({
      region: config.get('AWS_REGION', { infer: true }),
    });
    this.bucket = config.get('S3_PUBLIC_FILE_BUCKET', { infer: true });
  }

  // 반환 시그니처에 AWS SDK 타입 누출 금지 — plain 객체로 명시.
  async createUploadTarget(params: {
    key: string;
    contentType: string;
    maxSizeBytes: number;
  }): Promise<{
    url: string;
    fields: Record<string, string>;
    expiresAt: string;
  }> {
    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: this.bucket,
      // Key·Fields 엔트리는 policy에 exact-match 조건으로 자동 포함된다.
      Key: params.key,
      Fields: { 'Content-Type': params.contentType },
      Conditions: [['content-length-range', 1, params.maxSizeBytes]],
      Expires: UPLOAD_EXPIRES_SECONDS,
    });

    return {
      url,
      fields,
      expiresAt: new Date(
        Date.now() + UPLOAD_EXPIRES_SECONDS * 1000,
      ).toISOString(),
    };
  }

  // seam: 소비처(plant 등)가 첨부 시점에 "제출된 key가 실제 업로드됐는가"를 검증할 때 호출.
  // ⚠️ IAM에 s3:ListBucket이 없으면 미존재 키가 404 대신 403으로 온다 — 권한 구성 주의.
  async head(key: string): Promise<{ size: number } | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { size: res.ContentLength ?? 0 };
    } catch (e) {
      if (e instanceof NotFound) return null;
      throw e; // 403 등 권한 오류는 "없음"이 아니다 — 삼키지 않는다.
    }
  }
}
