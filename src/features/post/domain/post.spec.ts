import { describe, it, expect } from 'vitest';
import { Post, PostPatch, POST_TITLE_MAX_LENGTH } from './post';
import type { ProcessedPostContent } from './post-content';
import { InvalidPostTitleError } from './post.error';

const content: ProcessedPostContent = {
  content: '<p>본문</p>',
  excerpt: '본문',
  thumbnailKey: null,
  imageKeys: [],
};
const contentWithImage: ProcessedPostContent = {
  content: '<p>본문</p><img src="https://cdn.test.example/post-image/x.jpg" />',
  excerpt: '본문',
  thumbnailKey: 'post-image/x.jpg',
  imageKeys: ['post-image/x.jpg'],
};

describe('Post.create', () => {
  const valid = {
    authorId: '0198c5b2-2f74-7abc-8def-0123456789ab',
    title: '몬스테라 잎이 갈변해요',
    content,
    plantId: '0198c5b2-2f74-7abc-8def-0123456789ac',
  };

  it('유효한 입력으로 필드를 보존해 Post를 생성한다 — 묶음은 평평한 필드로 펼쳐진다', () => {
    const post = Post.create({ ...valid, content: contentWithImage });
    expect(post.authorId).toBe(valid.authorId);
    expect(post.plantId).toBe(valid.plantId);
    expect(post.title).toBe(valid.title);
    expect(post.content).toBe(contentWithImage.content);
    expect(post.excerpt).toBe(contentWithImage.excerpt);
    expect(post.thumbnailKey).toBe(contentWithImage.thumbnailKey);
    expect(post.imageKeys).toBe(contentWithImage.imageKeys);
  });

  it('id를 자동으로 생성한다 (uuid 형식, 호출마다 다름)', () => {
    expect(Post.create(valid).id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(Post.create(valid).id).not.toBe(Post.create(valid).id);
  });

  it('제목 앞뒤 공백을 제거한다', () => {
    expect(Post.create({ ...valid, title: '  제목  ' }).title).toBe('제목');
  });

  it('plantId 미제공 시 null (태그 없는 글)', () => {
    expect(
      Post.create({ authorId: valid.authorId, title: '제목', content }).plantId,
    ).toBeNull();
  });

  it(`제목 ${POST_TITLE_MAX_LENGTH}자는 통과한다`, () => {
    const title = '가'.repeat(POST_TITLE_MAX_LENGTH);
    expect(Post.create({ ...valid, title }).title).toBe(title);
  });

  it.each([
    ['공백뿐 (trim 후 0자)', '   '],
    [
      `${POST_TITLE_MAX_LENGTH + 1}자 (최대 초과)`,
      '가'.repeat(POST_TITLE_MAX_LENGTH + 1),
    ],
  ])('제목이 %s이면 InvalidPostTitleError', (_, title) => {
    expect(() => Post.create({ ...valid, title })).toThrow(
      InvalidPostTitleError,
    );
  });
});

describe('PostPatch.create', () => {
  it('undefined 필드는 그대로 통과한다 (미변경 의미 보존) — 파생 3필드 포함', () => {
    const patch = PostPatch.create({});
    expect(patch.title).toBeUndefined();
    expect(patch.content).toBeUndefined();
    expect(patch.excerpt).toBeUndefined();
    expect(patch.thumbnailKey).toBeUndefined();
    expect(patch.imageKeys).toBeUndefined();
    expect(patch.plantId).toBeUndefined();
  });

  it('제공된 title만 검증·trim한다', () => {
    expect(PostPatch.create({ title: '  제목  ' }).title).toBe('제목');
    expect(() => PostPatch.create({ title: '   ' })).toThrow(
      InvalidPostTitleError,
    );
  });

  it('plantId null(태그 해제)과 값(교체)을 구분해 보존한다', () => {
    expect(PostPatch.create({ plantId: null }).plantId).toBeNull();
    const id = '0198c5b2-2f74-7abc-8def-0123456789ac';
    expect(PostPatch.create({ plantId: id }).plantId).toBe(id);
  });

  it('content 묶음 제공 시 파생 3필드가 반드시 함께 세팅된다 (분리 수정 경로 없음)', () => {
    const patch = PostPatch.create({ content: contentWithImage });
    expect(patch.content).toBe(contentWithImage.content);
    expect(patch.excerpt).toBe(contentWithImage.excerpt);
    expect(patch.thumbnailKey).toBe(contentWithImage.thumbnailKey);
    expect(patch.imageKeys).toBe(contentWithImage.imageKeys);
  });

  it('content 묶음의 thumbnailKey가 null(이미지 없는 본문)이면 null로 세팅된다 (미변경 아님)', () => {
    const patch = PostPatch.create({ content });
    expect(patch.content).toBe(content.content);
    expect(patch.thumbnailKey).toBeNull();
    expect(patch.imageKeys).toEqual([]);
  });
});
