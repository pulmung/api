import { uuidv7 } from 'uuidv7';
import { InvalidCommentContentError } from './comment.error';

// 불변식 한도 — DTO(Zod 경계)도 이 값을 import해 이중기재 drift를 막는다.
export const COMMENT_CONTENT_MAX_LENGTH = 2000;

// module-private — 작성(루트·답글)과 수정이 같은 불변식을 공유한다.
// 플레인텍스트라 post의 sanitize 파이프라인이 필요 없다 — trim·길이만.
function validateContent(raw: string): string {
  const content = raw.trim();
  if (content.length < 1 || content.length > COMMENT_CONTENT_MAX_LENGTH) {
    throw new InvalidCommentContentError();
  }
  return content;
}

/**
 * 댓글 — 물리 2계층(인스타그램 모델)의 도메인 표현. 팩토리가 둘로 갈리는 이유:
 * "멘션은 답글에만"이라는 불변식을 런타임 검사가 아니라 구조로 강제한다 —
 * createRoot에는 mentionedUserId 매개변수 자체가 없다(유효하지 않은 상태를 표현
 * 불가능하게, §6). 컨텍스트 의존 규칙(부모가 루트인가·같은 글인가·작성자 검증)은
 * 부모 행을 알아야 하므로 application/repository 몫.
 */
export class Comment {
  private constructor(
    readonly id: string,
    readonly postId: string,
    readonly authorId: string,
    readonly parentId: string | null,
    readonly mentionedUserId: string | null,
    readonly content: string,
  ) {}

  static createRoot(params: {
    postId: string;
    authorId: string;
    content: string;
  }): Comment {
    return new Comment(
      uuidv7(),
      params.postId,
      params.authorId,
      null,
      null,
      validateContent(params.content),
    );
  }

  static createReply(params: {
    postId: string;
    authorId: string;
    parentId: string;
    content: string;
    mentionedUserId?: string;
  }): Comment {
    return new Comment(
      uuidv7(),
      // 답글의 postId = 루트의 postId — 호출자(usecase)가 부모 행에서 복사한다.
      params.postId,
      params.authorId,
      params.parentId,
      // 멘션 실존 검증은 uuid 형식(DTO)·FK 23503(writer) 몫이라 여기선 passthrough.
      params.mentionedUserId ?? null,
      validateContent(params.content),
    );
  }
}

/**
 * 수정 커맨드 — 수정 가능한 것이 content 하나뿐이라(구조·멘션은 불변) merge-patch
 * 의미론이 필요 없다. 필드가 늘면 그때 PostPatch 패턴으로(YAGNI).
 */
export class CommentPatch {
  private constructor(readonly content: string) {}

  static create(params: { content: string }): CommentPatch {
    return new CommentPatch(validateContent(params.content));
  }
}
