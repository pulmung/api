import { randomBytes, createHash } from 'node:crypto';
import { uuidv7 } from 'uuidv7';

const SECRET_BYTES = 32;

// 새 세션 발급: sessionId 생성 + secret -> 토큰('sessionId.secret') + 저장용 해시
export function createRefreshToken() {
  const sessionId = uuidv7();
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  return {
    sessionId,
    token: `${sessionId}.${secret}`,
    tokenHash: hashSecret(secret),
  };
}

// 회전: 기존 sessionId 유지, secret만 새로 (reuse detection의 핵심 — id는 그대로)
export function rotateRefreshToken(sessionId: string) {
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  return { token: `${sessionId}.${secret}`, tokenHash: hashSecret(secret) };
}

// 검증용 파싱: 'sessionId.secret' → 분해 (형식 오류면 null)
export function parseRefreshToken(token: string) {
  const [sessionId, secret, ...rest] = token.split('.');
  if (!sessionId || !secret || rest.length > 0) return null;
  return { sessionId, secret };
}

export function hashSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}
