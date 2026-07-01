import type { Request } from 'express';

export type AuthUser = {
  id: string;
};

export type AuthenticatedRequest = Request & { user: AuthUser };
