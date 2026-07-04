import { describe, it, expect } from 'vitest';
import { prepareFileUpload } from './file-upload';
import { FILE_POLICIES } from './file-policy';
import { FileTooLargeError, UnsupportedFileTypeError } from './file.error';

describe('prepareFileUpload', () => {
  const valid = {
    purpose: 'plant-image' as const,
    contentType: 'image/jpeg',
  };
  const maxSizeBytes = FILE_POLICIES['plant-image'].maxSizeBytes;

  it('key = {purpose}/{uuidv7}.{ext} 형태를 생성한다', () => {
    const { key } = prepareFileUpload(valid);
    expect(key).toMatch(
      /^plant-image\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/i,
    );
  });

  it('매 호출마다 다른 key를 생성한다', () => {
    expect(prepareFileUpload(valid).key).not.toBe(prepareFileUpload(valid).key);
  });

  it('정책의 maxSizeBytes를 함께 반환한다 (presign 조건에 쓰임)', () => {
    expect(prepareFileUpload(valid).maxSizeBytes).toBe(maxSizeBytes);
  });

  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
  ])('확장자는 contentType(%s)에서 파생된다 → .%s', (contentType, ext) => {
    const { key } = prepareFileUpload({ ...valid, contentType });
    expect(key.endsWith(`.${ext}`)).toBe(true);
  });

  it.each([['image/gif'], ['image/heic'], ['application/pdf'], ['']])(
    '허용되지 않은 contentType(%s)이면 UnsupportedFileTypeError',
    (contentType) => {
      expect(() => prepareFileUpload({ ...valid, contentType })).toThrow(
        UnsupportedFileTypeError,
      );
    },
  );

  it('size가 maxSizeBytes와 같으면 통과한다 (경계)', () => {
    expect(() =>
      prepareFileUpload({ ...valid, size: maxSizeBytes }),
    ).not.toThrow();
  });

  it('size가 maxSizeBytes를 넘으면 FileTooLargeError (경계)', () => {
    expect(() =>
      prepareFileUpload({ ...valid, size: maxSizeBytes + 1 }),
    ).toThrow(FileTooLargeError);
  });

  it('size를 생략하면 크기 검사 없이 통과한다 (최종 강제는 S3 policy)', () => {
    expect(() => prepareFileUpload(valid)).not.toThrow();
  });
});
