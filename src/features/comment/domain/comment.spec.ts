import { describe, it, expect } from 'vitest';
import { Comment, CommentPatch, COMMENT_CONTENT_MAX_LENGTH } from './comment';
import { InvalidCommentContentError } from './comment.error';

const postId = '0198c5b2-2f74-7abc-8def-0123456789ab';
const authorId = '0198c5b2-2f74-7abc-8def-0123456789ac';
const parentId = '0198c5b2-2f74-7abc-8def-0123456789ad';
const mentionedUserId = '0198c5b2-2f74-7abc-8def-0123456789ae';

describe('Comment.createRoot', () => {
  it('유효한 입력으로 필드를 보존해 생성한다 — 루트는 parentId·mentionedUserId가 null', () => {
    const comment = Comment.createRoot({ postId, authorId, content: '댓글' });
    expect(comment.postId).toBe(postId);
    expect(comment.authorId).toBe(authorId);
    expect(comment.parentId).toBeNull();
    expect(comment.mentionedUserId).toBeNull();
    expect(comment.content).toBe('댓글');
  });

  it('id를 자동으로 생성한다 (uuid 형식, 호출마다 다름)', () => {
    const params = { postId, authorId, content: '댓글' };
    expect(Comment.createRoot(params).id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(Comment.createRoot(params).id).not.toBe(
      Comment.createRoot(params).id,
    );
  });

  it('본문 앞뒤 공백을 제거한다', () => {
    expect(
      Comment.createRoot({ postId, authorId, content: '  댓글  ' }).content,
    ).toBe('댓글');
  });

  it(`본문 ${COMMENT_CONTENT_MAX_LENGTH}자는 통과한다`, () => {
    const content = '가'.repeat(COMMENT_CONTENT_MAX_LENGTH);
    expect(Comment.createRoot({ postId, authorId, content }).content).toBe(
      content,
    );
  });

  it.each([
    ['공백뿐 (trim 후 0자)', '   '],
    [
      `${COMMENT_CONTENT_MAX_LENGTH + 1}자 (최대 초과)`,
      '가'.repeat(COMMENT_CONTENT_MAX_LENGTH + 1),
    ],
  ])('본문이 %s이면 InvalidCommentContentError', (_, content) => {
    expect(() => Comment.createRoot({ postId, authorId, content })).toThrow(
      InvalidCommentContentError,
    );
  });
});

describe('Comment.createReply', () => {
  const valid = { postId, authorId, parentId, content: '답글' };

  it('parentId·mentionedUserId를 보존한다', () => {
    const reply = Comment.createReply({ ...valid, mentionedUserId });
    expect(reply.parentId).toBe(parentId);
    expect(reply.mentionedUserId).toBe(mentionedUserId);
  });

  it('mentionedUserId 미제공 시 null (루트에 다는 일반 답글)', () => {
    expect(Comment.createReply(valid).mentionedUserId).toBeNull();
  });

  it('루트와 같은 본문 불변식을 공유한다 (trim·빈 본문 거부)', () => {
    expect(Comment.createReply({ ...valid, content: '  답글  ' }).content).toBe(
      '답글',
    );
    expect(() => Comment.createReply({ ...valid, content: '   ' })).toThrow(
      InvalidCommentContentError,
    );
  });
});

describe('CommentPatch.create', () => {
  it('본문을 검증·trim한다', () => {
    expect(CommentPatch.create({ content: '  수정  ' }).content).toBe('수정');
  });

  it.each([
    ['공백뿐', '   '],
    ['최대 초과', '가'.repeat(COMMENT_CONTENT_MAX_LENGTH + 1)],
  ])('본문이 %s이면 InvalidCommentContentError', (_, content) => {
    expect(() => CommentPatch.create({ content })).toThrow(
      InvalidCommentContentError,
    );
  });
});
