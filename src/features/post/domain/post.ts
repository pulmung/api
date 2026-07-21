import { uuidv7 } from 'uuidv7';
import type { ProcessedPostContent } from './post-content';
import { InvalidPostTitleError } from './post.error';

// 불변식 한도 — DTO(Zod 경계)도 이 값을 import해 이중기재 drift를 막는다.
export const POST_TITLE_MAX_LENGTH = 200;

// module-private — Post.create(작성)와 PostPatch.create(수정)가 같은 불변식을 공유한다.
function validateTitle(raw: string): string {
  const title = raw.trim();
  if (title.length < 1 || title.length > POST_TITLE_MAX_LENGTH) {
    throw new InvalidPostTitleError();
  }
  return title;
}

/**
 * 게시글 — 커뮤니티 게시판의 루트. 필드는 평평하지만(테이블·읽기 모델과 동형),
 * 팩토리가 본문을 raw 문자열이 아니라 processPostContent의 산출물(묶음)로만 받으므로
 * "sanitize 안 된 본문"도 "파생(excerpt·thumbnailKey·imageKeys) 없이 본문만 세팅된
 * Post"도 표현 불가능하다(§6 — 불변식은 팩토리가, post.schema.ts 규율 ①·②).
 * 작성자 검증(내 글만 수정/삭제)은 컨텍스트 의존 규칙이라 application/repository 몫.
 */
export class Post {
  private constructor(
    readonly id: string,
    readonly authorId: string,
    readonly plantId: string | null,
    readonly title: string,
    readonly content: string,
    readonly excerpt: string,
    readonly thumbnailKey: string | null,
    readonly imageKeys: string[],
  ) {}

  static create(params: {
    authorId: string;
    title: string;
    content: ProcessedPostContent;
    plantId?: string | null;
  }): Post {
    return new Post(
      uuidv7(),
      params.authorId,
      // 식물 태그는 옵셔널(무관한 글이 정상 상태) — 실존 검증은 uuid 형식(DTO)·
      // FK 23503(writer) 몫이라 여기선 passthrough.
      params.plantId ?? null,
      validateTitle(params.title),
      params.content.content,
      params.content.excerpt,
      params.content.thumbnailKey,
      params.content.imageKeys,
    );
  }
}

/**
 * 부분 수정 커맨드 (JSON Merge Patch, RFC 7396): undefined = 미변경, plantId null = 태그 해제.
 * content는 묶음(ProcessedPostContent)으로만 받아 내부에서 펼친다 — content가 패치되면
 * 파생 3필드도 반드시 함께 정의되고, 본문 없이 파생만(또는 그 역) 패치되는 경로가 없다.
 * title은 notnull 컬럼이라 null 불가. "빈 패치 거부"는 HTTP 관심사 → DTO(.refine 400) 몫.
 */
export class PostPatch {
  private constructor(
    readonly title: string | undefined,
    readonly content: string | undefined,
    readonly excerpt: string | undefined,
    readonly thumbnailKey: string | null | undefined,
    readonly imageKeys: string[] | undefined,
    readonly plantId: string | null | undefined,
  ) {}

  static create(params: {
    title?: string;
    content?: ProcessedPostContent;
    plantId?: string | null;
  }): PostPatch {
    return new PostPatch(
      // undefined(미변경)는 통과, 값일 때만 검증 — create와 undefined 의미가 다르다.
      params.title === undefined ? undefined : validateTitle(params.title),
      params.content?.content,
      params.content?.excerpt,
      // ?. 가 두 의미를 정확히 갈라준다: content 미제공 → undefined(미변경),
      // 제공 → 묶음의 값(이미지 없는 본문이면 null 포함).
      params.content?.thumbnailKey,
      params.content?.imageKeys,
      params.plantId,
    );
  }
}
