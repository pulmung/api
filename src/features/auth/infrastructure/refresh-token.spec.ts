import { describe, it, expect } from 'vitest';
import {
  createRefreshToken,
  rotateRefreshToken,
  parseRefreshToken,
  hashSecret,
} from './refresh-token';

describe('parseRefreshToken', () => {
  it('정상 토큰 -> sessionId/secret 분해', () => {
    expect(parseRefreshToken('sess.secret')).toEqual({
      sessionId: 'sess',
      secret: 'secret',
    });
  });

  it.each(['', 'nodot', 'a.', '.b', 'a.b.c'])(
    '형식 오류 -> null: "%s"',
    (token) => {
      expect(parseRefreshToken(token)).toBeNull();
    },
  );
});

describe('createRefreshToken', () => {
  it('저장 해시가 토큰 속 secret과 대응한다', () => {
    const { token, tokenHash } = createRefreshToken();
    const parsed = parseRefreshToken(token)!;
    expect(hashSecret(parsed.secret)).toBe(tokenHash);
  });

  it('호출마다 다른 토큰을 만든다', () => {
    expect(createRefreshToken().token).not.toBe(createRefreshToken().token);
  });
});

describe('rotateRefreshToken', () => {
  it('sessionId는 보존하고 secret만 회전한다', () => {
    const sessionId = 'fixed-session-id';
    const { token, tokenHash } = rotateRefreshToken(sessionId);
    const parsed = parseRefreshToken(token)!;

    expect(parsed.sessionId).toBe(sessionId);
    expect(hashSecret(parsed.secret)).toBe(tokenHash);
  });

  it('같은 sessionId여도 secret은 매번 다르다', () => {
    expect(rotateRefreshToken('s').token).not.toBe(
      rotateRefreshToken('s').token,
    );
  });
});
