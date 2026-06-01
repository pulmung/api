import { pgTableCreator } from 'drizzle-orm/pg-core';

/**
 * 프로젝트 전역 테이블 팩토리.
 *
 * drizzle v1.0부터 글로벌 `casing` 옵션(`drizzle(pool, { casing })`)이 제거되어,
 * snake_case 변환을 테이블 정의 단계에 주입한다. 모든 스키마 파일은
 * `drizzle-orm/pg-core`의 `pgTable`이 아니라 **이 `pgTable`** 을 사용한다.
 * → 코드 camelCase(`createdAt`) ↔ DB snake_case(`created_at`) 변환이 단일 소스로 보장된다.
 */
export const pgTable = pgTableCreator((name) => name, 'snake_case');
