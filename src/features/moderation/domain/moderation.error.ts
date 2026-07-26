import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';

// 자기 자신을 차단 — 422(라우트 대상은 존재하므로 404가 아니고, 형식 오류도 아니라 400이
// 아니다. "의미상 처리 불가"가 422다 — ReferencedPlantNotFoundError와 같은 결).
// DB CHECK가 아니라 여기서 막는다: race가 없는 불변식이라 앱 검사로 충분하다
// (user-block.table.ts doc "self-block" 참조).
export class SelfBlockError extends DomainError {
  readonly code = 'SELF_BLOCK';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

// 차단 대상 유저가 존재하지 않음 — 라우트 대상(URL)의 부재라 404.
// user의 UserNotFoundError를 재사용하지 않는 이유: 그건 "내 프로필이 없다"(GET /users/me,
// 탈퇴 후 토큰 잔존)를 뜻해 클라 처리가 로그아웃 유도다. 여기선 "남이 없다"이므로
// 같은 코드를 주면 클라가 나를 로그아웃시킨다.
export class BlockTargetNotFoundError extends DomainError {
  readonly code = 'BLOCK_TARGET_NOT_FOUND';
  readonly status = HttpStatus.NOT_FOUND;
}

// 신고 대상(post/comment/user)이 존재하지 않거나 이미 삭제됨 — body 참조가 아니라
// 신고라는 연산의 대상 그 자체이므로 422가 아니라 404.
// 세 타입을 하나의 코드로 합친다: 클라가 타입별로 다르게 처리할 일이 없다(어차피
// "대상이 사라졌습니다" 한 문구) — 필요해지면 그때 가른다.
export class ReportTargetNotFoundError extends DomainError {
  readonly code = 'REPORT_TARGET_NOT_FOUND';
  readonly status = HttpStatus.NOT_FOUND;
}

// 같은 대상을 이미 신고했다 — 409. 멱등 성공으로 삼키지 않는 이유: 좋아요(PUT)와 달리
// 신고는 "접수됨"이 유저에게 의미 있는 상태라, 두 번째 요청을 조용히 성공시키면 클라가
// "이미 신고하셨습니다"를 말할 수 없다.
export class ReportAlreadyExistsError extends DomainError {
  readonly code = 'REPORT_ALREADY_EXISTS';
  readonly status = HttpStatus.CONFLICT;
}
