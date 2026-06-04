export abstract class UserDomainError extends Error {}

export class InvalidNicknameError extends UserDomainError {}

export class NicknameTakenError extends UserDomainError {}

export class UserAlreadyRegisteredError extends UserDomainError {}
