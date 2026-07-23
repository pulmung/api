import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';

// 비존재·타인 댓글·soft-deleted 모두 이 하나로 수렴(존재 은닉) — post와 동일 결.
// soft-deleted는 목록에서 플레이스홀더로 "보이는" 상태지만, 표적 연산(답글 작성·
// 수정·삭제)에는 소멸한 리소스다 — 읽기(답글 목록)만 예외로 살아 있다.
export class CommentNotFoundError extends DomainError {
  readonly code = 'COMMENT_NOT_FOUND';
  readonly status = HttpStatus.NOT_FOUND;
}

export class InvalidCommentContentError extends DomainError {
  readonly code = 'INVALID_COMMENT_CONTENT';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

// 답글 대상이 루트가 아니라 답글 — 물리 2계층 불변식 위반. "답글에 답글"은
// 같은 루트 밑 형제 답글 + mentionedUserId로 표현하라는 신호를 클라에 준다.
export class ReplyDepthExceededError extends DomainError {
  readonly code = 'REPLY_DEPTH_EXCEEDED';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

// body의 mentionedUserId가 존재하지 않는 유저 (INSERT 시 FK 23503).
// 404가 아니라 422 — 404는 라우트 대상(URL)의 부재이고, 이건 본문 참조의 부재다
// (ReferencedPlantNotFoundError 전례).
export class MentionedUserNotFoundError extends DomainError {
  readonly code = 'MENTIONED_USER_NOT_FOUND';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}
