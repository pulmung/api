/**
 * 도메인/영속 계층의 의미 있는 실패. 프레임워크(Nest) 비의존.
 * application 계층(usecase)이 HTTP 예외로 번역한다.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** (provider, providerUserId) 가 이미 가입돼 있음. */
export class UserAlreadyExistsError extends DomainError {
  constructor() {
    super('user already registered for this social identity');
  }
}

/** nickname 이 이미 사용 중. */
export class NicknameAlreadyTakenError extends DomainError {
  constructor() {
    super('nickname already taken');
  }
}
