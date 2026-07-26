import type { TransactionalAdapter } from '@nestjs-cls/transactional';
import type { PgTransactionConfig } from 'drizzle-orm/pg-core';
import { DRIZZLE, type DrizzleDB } from './drizzle.constants';

/**
 * `@nestjs-cls/transactional`의 drizzle 어댑터 — **직접 구현한다.**
 *
 * 공식 패키지(`@nestjs-cls/transactional-adapter-drizzle-orm`)를 쓰지 않는 이유: peer가
 * `drizzle-orm@^0`이라 우리가 쓰는 v1.0 RC를 지원하지 않는다. `--legacy-peer-deps`로
 * 눌러 쓸 수도 있지만, 그건 "동작할 것 같다"에 기대는 것이고 업그레이드 때 조용히 깨진다.
 * 어댑터가 실제로 요구하는 계약은 아래 두 함수뿐이고(`TransactionalAdapter` 인터페이스는
 * 커스텀 구현을 위해 공개돼 있다), drizzle v1의 `db.transaction(cb, config)` 위에 그대로
 * 얹힌다 — 20줄로 정확한 버전을 갖는 편이 낫다. 공식 어댑터가 v1을 지원하면 그때 교체.
 *
 * 하는 일: `@Transactional()`이 이 어댑터의 `wrapWithTransaction`을 호출 → drizzle
 * 트랜잭션을 열고 그 핸들(`tx`)을 CLS에 심는다 → 그 안에서 실행되는 모든 어댑터가
 * `TransactionHost.tx`로 같은 핸들을 집어간다. 트랜잭션 밖에서는 `getFallbackInstance`가
 * 평범한 db를 주므로 같은 코드가 트랜잭션 유무와 무관하게 동작한다.
 *
 * TTx가 `DrizzleDB`인 이유: drizzle의 트랜잭션 핸들은 db와 같은 베이스(`PgAsyncDatabase`)를
 * 상속해 쿼리 API가 동일하다 → 소비처(writer)가 분기 없이 하나의 타입으로 다룬다.
 */
export class DrizzleTransactionalAdapter
  implements TransactionalAdapter<DrizzleDB, DrizzleDB, PgTransactionConfig>
{
  connectionToken = DRIZZLE;

  optionsFactory = (drizzle: DrizzleDB) => ({
    wrapWithTransaction: (
      options: PgTransactionConfig,
      fn: (...args: unknown[]) => Promise<unknown>,
      setTx: (client?: DrizzleDB) => void,
    ) =>
      drizzle.transaction(async (tx) => {
        setTx(tx);
        return fn();
      }, options),

    // 이미 트랜잭션 안인데 `Propagation.Nested`로 진입한 경우 — drizzle의 중첩
    // transaction은 SAVEPOINT라 안쪽만 롤백할 수 있다. 지금 쓰는 곳은 없지만 인터페이스의
    // 세 갈래 중 하나를 비워두면 나중에 `Nested`를 썼을 때 런타임에서야 드러난다.
    wrapWithNestedTransaction: (
      options: PgTransactionConfig,
      fn: (...args: unknown[]) => Promise<unknown>,
      setTx: (client?: DrizzleDB) => void,
      tx: DrizzleDB,
    ) =>
      tx.transaction(async (nested) => {
        setTx(nested);
        return fn();
      }, options),

    // 트랜잭션 밖에서의 기본 핸들 — 읽기 전용 경로·단문 쓰기가 트랜잭션 없이 그대로 돈다.
    getFallbackInstance: () => drizzle,
  });
}
