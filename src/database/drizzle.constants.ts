import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export const DRIZZLE = Symbol('DRIZZLE');

// v1.0: 제네릭이 schema가 아니라 relations(RQBv2)다. RQB 미사용이므로 기본값(EmptyRelations) 사용.
export type DrizzleDB = NodePgDatabase;
