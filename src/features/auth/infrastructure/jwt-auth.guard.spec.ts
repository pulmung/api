import { describe, it, expect, vi } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard, IS_OPTIONAL_AUTH_KEY } from './jwt-auth.guard';
import { UnauthenticatedError } from '../domain/auth.error';

type Meta = { isOptional?: boolean };

function makeContext(authorization?: string) {
  const request: {
    headers: Record<string, string | undefined>;
    user?: unknown;
  } = { headers: { authorization } };

  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
}

function makeGuard(meta: Meta, verifyImpl?: () => Promise<unknown>) {
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === IS_OPTIONAL_AUTH_KEY ? meta.isOptional : undefined,
  } as unknown as Reflector;

  const verifyAsync = vi.fn(verifyImpl);
  const jwt = { verifyAsync } as unknown as JwtService;

  return { guard: new JwtAuthGuard(jwt, reflector), verifyAsync };
}

describe('JwtAuthGuard', () => {
  it('유효한 토큰 -> true 이고 req.user.id를 sub로 채운다', async () => {
    const { guard, verifyAsync } = makeGuard({}, () =>
      Promise.resolve({ sub: 'user-uuid' }),
    );
    const { context, request } = makeContext('Bearer good.token');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-uuid' });
    // HS256 고정이 실제로 넘어가는지까지 확인
    expect(verifyAsync).toHaveBeenCalledWith('good.token', {
      algorithms: ['HS256'],
    });
  });

  it('소문자 bearer 스킴도 허용한다', async () => {
    const { guard } = makeGuard({}, () => Promise.resolve({ sub: 'u' }));
    const { context, request } = makeContext('bearer good');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'u' });
  });

  it('Authorization 헤더 없음 -> UnauthenticatedError', async () => {
    const { guard } = makeGuard({});
    const { context } = makeContext(undefined);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('Bearer 스킴이 아니면 -> UnauthenticatedError', async () => {
    const { guard } = makeGuard({});
    const { context } = makeContext('Basic abc');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('빈 토큰 -> UnauthenticatedError', async () => {
    const { guard } = makeGuard({});
    const { context } = makeContext('Bearer ');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('verifyAsync 실패(만료/위조) -> UnauthenticatedError', async () => {
    const { guard } = makeGuard({}, () =>
      Promise.reject(new Error('jwt expired')),
    );
    const { context } = makeContext('Bearer expired.token');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('payload.sub가 문자열이 아니면 -> UnauthenticatedError', async () => {
    const { guard } = makeGuard({}, () => Promise.resolve({ sub: 123 }));
    const { context } = makeContext('Bearer weird.token');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('@OptionalAuth + 토큰 없음 -> 익명 통과(req.user undefined, 검증 안 함)', async () => {
    const { guard, verifyAsync } = makeGuard({ isOptional: true });
    const { context, request } = makeContext(undefined);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('@OptionalAuth + 유효 토큰 -> req.user 채움', async () => {
    const { guard } = makeGuard({ isOptional: true }, () =>
      Promise.resolve({ sub: 'u2' }),
    );
    const { context, request } = makeContext('Bearer good');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'u2' });
  });

  it('@OptionalAuth + 깨진 토큰 -> UnauthenticatedError (보냈으면 유효해야)', async () => {
    const { guard } = makeGuard({ isOptional: true }, () =>
      Promise.reject(new Error()),
    );
    const { context } = makeContext('Bearer broken');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});
