import { describe, it, expect } from 'vitest';
import { CONTENT_TYPE_EXT, FILE_POLICIES } from './file-policy';
import { filePurposes } from './file-purpose';

// 정책 맵 무결성 — 타입이 못 잡는 값 수준 실수(빈 배열, 0 크기)를 방어한다.
describe('FILE_POLICIES', () => {
  it.each(filePurposes.map((p) => [p]))(
    '%s: 허용 타입이 1개 이상이고 전부 CONTENT_TYPE_EXT에 매핑된다',
    (purpose) => {
      const policy = FILE_POLICIES[purpose];
      expect(policy.allowedContentTypes.length).toBeGreaterThan(0);
      for (const contentType of policy.allowedContentTypes) {
        expect(CONTENT_TYPE_EXT[contentType]).toBeTruthy();
      }
    },
  );

  it.each(filePurposes.map((p) => [p]))(
    '%s: maxSizeBytes가 양수다',
    (purpose) => {
      expect(FILE_POLICIES[purpose].maxSizeBytes).toBeGreaterThan(0);
    },
  );
});
