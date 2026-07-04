import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { ConfigService } from '@nestjs/config';
import { S3FileStorage } from './s3-file.storage';
import { Env } from '../../../config/env.validation';

const REGION = 'ap-northeast-2';
const BUCKET = 'test-bucket';
const MAX_SIZE = 10 * 1024 * 1024;

// ConfigService는 부분 mock으로 충분 — 구현 직접 주입이라 TestingModule 불필요(new로 바로)
const config = {
  get: (key: string) => (key === 'AWS_REGION' ? REGION : BUCKET),
} as unknown as ConfigService<Env, true>;

let storage: S3FileStorage;

beforeAll(() => {
  // default credential chain의 첫 순번(env)이 잡히게 한다 — 없으면 IMDS 프로브로 행 걸림
  process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
  storage = new S3FileStorage(config);
});

// head() 전용 — createUploadTarget은 HTTP 호출 0(로컬 서명)이라 MSW 불필요
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('S3FileStorage.createUploadTarget', () => {
  const create = () =>
    storage.createUploadTarget({
      key: 'plant-image/test.jpg',
      contentType: 'image/jpeg',
      maxSizeBytes: MAX_SIZE,
    });

  const decodePolicy = (policyBase64: string) =>
    JSON.parse(Buffer.from(policyBase64, 'base64').toString('utf8')) as {
      expiration: string;
      conditions: unknown[];
    };

  it('policy에 content-length-range(크기 강제)가 박힌다', async () => {
    const target = await create();
    const policy = decodePolicy(target.fields.Policy);
    expect(policy.conditions).toContainEqual([
      'content-length-range',
      1,
      MAX_SIZE,
    ]);
  });

  it('policy에 key exact-match가 박힌다 (다른 키로 업로드 불가)', async () => {
    const target = await create();
    const policy = decodePolicy(target.fields.Policy);
    expect(policy.conditions).toContainEqual({ key: 'plant-image/test.jpg' });
  });

  it('policy에 Content-Type exact-match가 박힌다 (타입 위장 불가)', async () => {
    const target = await create();
    const policy = decodePolicy(target.fields.Policy);
    expect(policy.conditions).toContainEqual({ 'Content-Type': 'image/jpeg' });
  });

  it('fields에 key·Content-Type·서명 필드가 채워진다', async () => {
    const { fields } = await create();
    expect(fields.key).toBe('plant-image/test.jpg');
    expect(fields['Content-Type']).toBe('image/jpeg');
    expect(fields['X-Amz-Signature']).toBeDefined();
  });

  it('url이 대상 버킷을 가리킨다', async () => {
    const { url } = await create();
    expect(url).toContain(BUCKET);
  });

  it('expiresAt ≈ 지금 + 300초 (±10초 허용)', async () => {
    const { expiresAt } = await create();
    const diff = new Date(expiresAt).getTime() - (Date.now() + 300_000);
    expect(Math.abs(diff)).toBeLessThan(10_000);
  });
});

describe('S3FileStorage.head', () => {
  const KEY = 'plant-image/test.jpg';
  const url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${KEY}`;

  const headResponds = (status: number, contentLength?: number) =>
    server.use(
      http.head(url, () =>
        contentLength === undefined
          ? new HttpResponse(null, { status })
          : new HttpResponse(null, {
              status,
              headers: { 'content-length': String(contentLength) },
            }),
      ),
    );

  it('존재하는 객체 → { size }', async () => {
    headResponds(200, 123);
    await expect(storage.head(KEY)).resolves.toEqual({ size: 123 });
  });

  it('404(미존재) → null', async () => {
    headResponds(404);
    await expect(storage.head(KEY)).resolves.toBeNull();
  });

  it('403(권한 오류)은 null이 아니라 rethrow — 삼키지 않는다', async () => {
    headResponds(403);
    await expect(storage.head(KEY)).rejects.toThrow();
  });
});
