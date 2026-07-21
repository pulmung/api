import { describe, it, expect } from 'vitest';
import {
  POST_CONTENT_MAX_LENGTH,
  POST_EXCERPT_MAX_LENGTH,
  POST_IMAGES_MAX,
  processPostContent,
} from './post-content';
import {
  InvalidPostContentError,
  InvalidPostImageSrcError,
} from './post.error';

// PublicFileUrlResolver.tryParseKey와 같은 계약의 한 줄 람다 — mock 0.
const BASE_URL = 'https://cdn.test.example';
const parseImageKey = (url: string): string | null =>
  url.startsWith(`${BASE_URL}/`) ? url.slice(BASE_URL.length + 1) : null;

const process = (rawHtml: string) =>
  processPostContent(rawHtml, { parseImageKey });

const key = (n: number) =>
  `post-image/0198c5b2-2f74-7abc-8def-00000000${String(n).padStart(4, '0')}.jpg`;
const img = (k: string) => `<img src="${BASE_URL}/${k}" />`;

describe('processPostContent — 정화 (Pass A)', () => {
  it('허용 태그·정규화·파생을 한 번에: 대표 happy path', () => {
    const result = process(
      `<p>몬스테라 <b>잎</b>이 <span class="color-red">갈변</span>해요</p>${img(key(1))}`,
    );
    expect(result.content).toBe(
      `<p>몬스테라 <strong>잎</strong>이 <span class="color-red">갈변</span>해요</p>${img(key(1))}`,
    );
    expect(result.excerpt).toBe('몬스테라 잎이 갈변해요');
    expect(result.thumbnailKey).toBe(key(1));
    expect(result.imageKeys).toEqual([key(1)]);
  });

  it.each([
    ['script 태그+내용 통째 드랍', '<p>a</p><script>alert(1)</script>', '<p>a</p>'],
    ['style 태그+내용 통째 드랍', '<p>a</p><style>p{color:red}</style>', '<p>a</p>'],
    ['iframe 제거(텍스트 없음)', '<p>a</p><iframe src="https://evil.example"></iframe>', '<p>a</p>'],
    ['비허용 태그는 벗기고 텍스트 보존', '<h1>제목</h1><div><p>본문</p></div>', '제목<p>본문</p>'],
    ['이벤트 핸들러 속성 제거', '<p onclick="alert(1)">a</p>', '<p>a</p>'],
    ['style 속성 제거 (인라인 색 금지 — 팔레트 class만)', '<p style="color:#000">a</p>', '<p>a</p>'],
    ['span의 팔레트 외 class 제거', '<span class="evil">a</span>', '<span>a</span>'],
    ['팔레트 class는 유지, 비팔레트만 걸러냄', '<span class="color-blue evil">a</span>', '<span class="color-blue">a</span>'],
    ['b→strong 정규화', '<p><b>a</b></p>', '<p><strong>a</strong></p>'],
    ['del→s 정규화', '<p><del>a</del></p>', '<p><s>a</s></p>'],
    ['strike→s 정규화', '<p><strike>a</strike></p>', '<p><s>a</s></p>'],
    ['a 태그 제거(텍스트 보존) — 링크 미지원', '<p><a href="https://x.example">링크</a></p>', '<p>링크</p>'],
  ])('%s', (_, input, expected) => {
    expect(process(input).content).toBe(expected);
  });

  it('img onerror 등 src 외 속성은 제거하고 src만 남긴다', () => {
    const result = process(
      `<p>a</p><img src="${BASE_URL}/${key(1)}" onerror="alert(1)" style="width:9999px" />`,
    );
    expect(result.content).toBe(`<p>a</p>${img(key(1))}`);
  });

  it.each([
    ['외부 도메인', 'https://evil.example/post-image/x.jpg'],
    ['우리 CDN이지만 다른 purpose(plant-image)', `${BASE_URL}/plant-image/x.jpg`],
    ['src 없음', ''],
    ['javascript: 스킴', 'javascript:alert(1)'],
  ])('img src가 %s이면 InvalidPostImageSrcError', (_, src) => {
    expect(() => process(`<p>a</p><img src="${src}" />`)).toThrow(
      InvalidPostImageSrcError,
    );
  });
});

describe('processPostContent — 발췌 (Pass B-2)', () => {
  it('블록 경계는 공백으로 잇는다', () => {
    expect(process('<p>사과</p><p>바나나</p>').excerpt).toBe('사과 바나나');
    expect(process('<p>사과<br />바나나</p>').excerpt).toBe('사과 바나나');
  });

  it('인라인 서식은 공백 없이 벗긴다 (단어 중간 서식)', () => {
    expect(process('<p>안<strong>녕</strong>하세요</p>').excerpt).toBe(
      '안녕하세요',
    );
  });

  it('연속 공백·개행은 하나로 접는다', () => {
    expect(process('<p>a   b\n\nc</p>').excerpt).toBe('a b c');
  });

  it('이스케이프된 엔티티를 복원한다 (excerpt는 플레인텍스트)', () => {
    expect(process('<p>A &amp; B &lt;tag&gt;</p>').excerpt).toBe('A & B <tag>');
    // content(HTML)에는 이스케이프가 유지된다.
    expect(process('<p>A &amp; B</p>').content).toBe('<p>A &amp; B</p>');
  });

  it(`${POST_EXCERPT_MAX_LENGTH}자는 그대로, 초과분은 절단한다`, () => {
    const exact = 'a'.repeat(POST_EXCERPT_MAX_LENGTH);
    expect(process(`<p>${exact}</p>`).excerpt).toBe(exact);
    expect(process(`<p>${exact}b</p>`).excerpt).toBe(exact);
  });

  it('절단은 코드포인트 단위 — 이모지(서로게이트 쌍)를 반 토막 내지 않는다', () => {
    const emojis = '🌱'.repeat(POST_EXCERPT_MAX_LENGTH + 5);
    const excerpt = process(`<p>${emojis}</p>`).excerpt;
    expect([...excerpt].length).toBe(POST_EXCERPT_MAX_LENGTH);
    expect(excerpt).toBe('🌱'.repeat(POST_EXCERPT_MAX_LENGTH));
  });
});

describe('processPostContent — 이미지 파생 (Pass B-1)', () => {
  it('이미지-only 글은 정상: excerpt는 빈 문자열, 썸네일이 대표', () => {
    const result = process(img(key(1)) + img(key(2)));
    expect(result.excerpt).toBe('');
    expect(result.thumbnailKey).toBe(key(1));
    expect(result.imageKeys).toEqual([key(1), key(2)]);
  });

  it('썸네일 = 문서 순서 첫 이미지 (텍스트 뒤에 있어도)', () => {
    const result = process(`<p>본문</p>${img(key(7))}${img(key(3))}`);
    expect(result.thumbnailKey).toBe(key(7));
  });

  it('같은 이미지 중복 삽입은 허용하되 imageKeys는 고유하다', () => {
    const result = process(`<p>a</p>${img(key(1))}${img(key(1))}`);
    expect(result.imageKeys).toEqual([key(1)]);
    // 저장본에는 중복이 그대로 남는다(표현은 유저 자유).
    expect(result.content).toBe(`<p>a</p>${img(key(1))}${img(key(1))}`);
  });

  it(`고유 이미지 ${POST_IMAGES_MAX}개는 통과, ${POST_IMAGES_MAX + 1}개는 InvalidPostContentError`, () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, i) => img(key(i))).join('');
    expect(process(many(POST_IMAGES_MAX)).imageKeys).toHaveLength(
      POST_IMAGES_MAX,
    );
    expect(() => process(many(POST_IMAGES_MAX + 1))).toThrow(
      InvalidPostContentError,
    );
  });
});

describe('processPostContent — 본문 규약', () => {
  it.each([
    ['빈 문자열', ''],
    ['공백뿐', '   \n  '],
    ['빈 문단뿐', '<p></p><p><br /></p>'],
    ['서식만 있고 알맹이 없음', '<p><strong>   </strong></p>'],
    ['태그가 전부 걸러져 알맹이 없음', '<script>alert(1)</script>'],
  ])('%s이면 InvalidPostContentError (텍스트도 이미지도 0)', (_, input) => {
    expect(() => process(input)).toThrow(InvalidPostContentError);
  });

  it(`원문 ${POST_CONTENT_MAX_LENGTH}자는 통과, 초과는 InvalidPostContentError`, () => {
    expect(() => process('a'.repeat(POST_CONTENT_MAX_LENGTH))).not.toThrow();
    expect(() => process('a'.repeat(POST_CONTENT_MAX_LENGTH + 1))).toThrow(
      InvalidPostContentError,
    );
  });

  it('평문 입력도 정상 처리한다 (태그 없는 글)', () => {
    const result = process('그냥 텍스트 글');
    expect(result.content).toBe('그냥 텍스트 글');
    expect(result.excerpt).toBe('그냥 텍스트 글');
    expect(result.thumbnailKey).toBeNull();
    expect(result.imageKeys).toEqual([]);
  });
});
