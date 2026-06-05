import { describe, it, expect } from 'vitest';
import { User } from './user';
import { InvalidNicknameError } from './user.error';

describe('User.register', () => {
  const valid = {
    provider: 'kakao' as const,
    providerUserId: '12345',
    email: 'user@kakao.com',
    nickname: '식집사',
  };

  it('유효한 입력으로 필드를 보존해 User를 생성한다', () => {
    const user = User.register(valid);
    expect(user.provider).toBe('kakao');
    expect(user.providerUserId).toBe('12345');
    expect(user.email).toBe('user@kakao.com');
    expect(user.nickname).toBe('식집사');
  });

  it('id를 자동으로 생성한다 (uuid 형식)', () => {
    const user = User.register(valid);
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('매 호출마다 다른 id를 생성한다', () => {
    expect(User.register(valid).id).not.toBe(User.register(valid).id);
  });

  it('닉네임 앞뒤 공백을 제거한다', () => {
    expect(User.register({ ...valid, nickname: '   식집사   ' }).nickname).toBe(
      '식집사',
    );
  });

  it('email이 null이어도 생성된다', () => {
    expect(User.register({ ...valid, email: null }).email).toBeNull();
  });

  it.each([
    ['1자 (최소 미만)', 'a'],
    ['공백뿐 (trim 후 0자)', '    '],
    ['21자 (최대 초과)', 'a'.repeat(21)],
  ])('닉네임이 %s 이면 InvalidNicknameError', (_, nickname) => {
    expect(() => User.register({ ...valid, nickname })).toThrow(
      InvalidNicknameError,
    );
  });

  it.each([
    ['2자 (최소)', 'ab'],
    ['20자 (최대)', 'a'.repeat(20)],
  ])('닉네임 경계값 %s 은 통과한다', (_, nickname) => {
    expect(() => User.register({ ...valid, nickname })).not.toThrow();
  });
});
