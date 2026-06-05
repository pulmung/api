export abstract class DomainError extends Error {
  abstract readonly code: string; // 'NICKNAME_TAKEN' 등 machine-readable 도메인 식별자
  abstract readonly status: number;
}
