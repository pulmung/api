export abstract class AuthDomainError extends Error {}

export class InvalidSocialTokenError extends AuthDomainError {}
