# CLAUDE.md

이 파일은 Claude Code(및 개발자)가 이 저장소에서 작업할 때 따르는 가이드다.
**핵심 원칙, 아키텍처 결정, 컨벤션의 단일 소스(single source of truth)** 로 유지한다.

---

## 프로젝트 개요

- **sikjipsa API** — NestJS 기반 REST API 서버.
- 목적: 최신 기술스택/컨벤션을 학습하며 적용한다. 의사결정마다 "왜"를 따진다.
- 아키텍처: **CQRS 패턴**(쓰기는 도메인을 거치고, 읽기는 우회한다)을 채택한다.

---

## 기술 스택

| 영역         | 선택                     | 버전        | 비고                              |
| ------------ | ------------------------ | ----------- | --------------------------------- |
| 런타임       | Node.js                  | 22.x        |                                   |
| 프레임워크   | NestJS                   | ^11.1       |                                   |
| 언어         | TypeScript               | ^6.0        | `strict`, `nodenext` 모듈 해석    |
| 빌드         | SWC (`nest-cli` builder) | —           | `typeCheck: true`로 타입검사 병행 |
| ORM          | Drizzle ORM              | ^0.45       | `drizzle-orm/node-postgres`       |
| DB 드라이버  | `pg` (node-postgres)     | ^8.21       | 커넥션 풀(`pg.Pool`) 사용         |
| 마이그레이션 | drizzle-kit              | ^0.31       |                                   |
| DB           | PostgreSQL               | (확인 필요) |                                   |
| 환경변수     | `@nestjs/config`         | ^4.0        | 전역 `ConfigModule` + DI          |
| ID 생성      | `uuidv7`                 | ^1.2        | 앱 레벨 UUIDv7 생성               |
| 테스트       | Vitest                   | ^4.1        | + Supertest(E2E)                  |

> **방향성**: 새 의존성/패턴 도입 시 "가장 최신 트렌드 + 근거 있는 선택"을 우선한다. 관성으로 굳어진 레거시 컨벤션(예: 모든 문자열 `varchar(255)`)은 의심한다.

---

## 명령어

```bash
# 개발
npm run build            # nest build

# 품질
npm run lint             # eslint --fix
npm run format           # prettier

# 테스트
npx vitest               # watch
npx vitest run           # 1회 실행 (CI)

# DB (drizzle-kit) — package.json
npx drizzle-kit generate # 스키마 변경 → 마이그레이션 SQL 생성
npx drizzle-kit migrate  # 마이그레이션 적용
npx drizzle-kit push     # 프로토타이핑용 직접 반영 (운영 X)
npx drizzle-kit studio   # GUI
```

---

## 아키텍처: CQRS

> **한 줄 요약: 쓰기(Command)는 도메인을 거치고, 읽기(Query)는 우회한다. DTO는 endpoint마다 별개로 만든다.**

도메인 모델은 **쓰기를 위한 것이지 읽기를 위한 것이 아니다.** 이 전제를 받아들이면 "성능 위해 컬럼 최소 select 하고 싶은데 도메인이 막는다"는 모순이 사라진다 — 그건 읽기 경로에 도메인을 잘못 끼워 넣은 설계다.

### 쓰기 경로 (Command)

```
Controller → UseCase → Domain Entity → Repository → DB
```

- 도메인 규칙/불변식(invariant)을 **Domain Entity가 캡슐화**한다.
- Repository는 도메인 객체 단위로 저장/조회한다.
- 상태 변경은 public setter가 아니라 **메서드(`order.cancel(now)`)** 를 통해서만.

### 읽기 경로 (Query)

```
Controller → QueryService → Drizzle 부분 select(필요 컬럼/조인만) → Response DTO
                              ↑ 도메인 객체를 거치지 않는다
```

- 성능을 위해 **필요한 컬럼만 select, 필요한 조인만** 한다.
- Drizzle 부분 select는 **반환 타입이 projection에 맞춰 자동 추론**되므로, 전체 행 타입(`$inferSelect`)을 억지로 쓰지 않는다.
- 각 endpoint는 **자기 전용 Response DTO**(읽기 모델)를 가진다.

### DTO 설계 규칙

- ❌ 모든 필드가 optional인 거대한 DTO 하나 → "타입이 거짓말을 한다".
- ✅ endpoint별로 **정확히 그 응답 형태만** 가진 작은 DTO 여러 개.
- DTO가 많아지는 건 정상이고 솔직한 것이다. **복잡한 1개보다 단순한 10개**.
- `optional(?)`은 _진짜로_ 값이 없을 수 있는 곳에만 쓴다.

---

## 디렉토리 구조

### 인프라 (DB)

```
src/database/
  schema/
    user.schema.ts        # 도메인별 테이블 정의
    index.ts              # barrel: 모든 스키마 re-export (drizzle()에 전달)
  drizzle.constants.ts    # 주입 토큰(DRIZZLE) + DB 타입(DrizzleDB)
  drizzle.module.ts       # @Global 모듈, pg.Pool 기반 커넥션 제공
drizzle.config.ts         # (루트) drizzle-kit CLI 설정
```

### 도메인 모듈 (CQRS, feature 단위) — 도메인 규칙이 있을 때

```
src/features/<feature>/
  domain/                 # 순수 TS. NestJS/ORM 무관
    <entity>.ts           #   Domain Entity (Aggregate Root)
    <entity>.repository.ts#   Repository 인터페이스(Port)
  application/
    <action>.usecase.ts   #   Command (쓰기)
    <feature>-query.service.ts  # Query (읽기) - 도메인 우회
  infrastructure/
    drizzle-<entity>.repository.ts  # Repository 구현(Adapter)
  presentation/
    <feature>.controller.ts
    dto/                  # endpoint별 Request/Response DTO
```

> 단순 CRUD 기능은 위 풀구조가 과하다. **기능의 도메인 복잡도에 맞춰 레벨을 선택**한다(아래 도메인 모델링 참고).

---

## 데이터베이스 / Drizzle 컨벤션

### 스키마 파일

- **도메인별로 분리**한다(`user.schema.ts`, `post.schema.ts` …) + `index.ts` barrel에서 모아 re-export.
  - 런타임 `drizzle(pool, { schema })`와 drizzle-kit `schema` 양쪽 모두 barrel을 가리킨다.
- **테이블명 = 복수형**(`users`), **파일명 = 단수형**(`user.schema.ts`).
  - Postgres 예약어 회피(`user`는 예약어) + 프레임워크 관례.

### 네이밍 (casing)

- **코드: camelCase**(`createdAt`) / **DB 컬럼: snake_case**(`created_at`).
- 변환은 Drizzle의 **`casing: 'snake_case'`** 에 위임한다 → 스키마에서 컬럼명 문자열을 생략한다.
- ⚠️ `casing: 'snake_case'`는 **drizzle.config.ts와 런타임 `drizzle()` 호출 양쪽에 동일하게** 넣어야 일관된다.

### 컬럼 타입 규칙

| 용도   | 사용                                             | 이유                                                                                     |
| ------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| PK     | `uuid().primaryKey().$defaultFn(() => uuidv7())` | **앱에서 UUIDv7 생성**. 시간순 정렬로 인덱스 단편화↓, INSERT 전 ID 확보 가능             |
| 문자열 | 기본 `text()`                                    | Postgres에선 `text`/`varchar` 성능 동일. `varchar(n)`은 **진짜 길이 제약이 필요할 때만** |
| 시각   | `timestamp({ withTimezone: true })`              | `timestamptz`. UTC 시점 저장 → 타임존 모호성 제거. (`timestamp` without tz 금지)         |

- `$defaultFn`(앱 생성)은 **Drizzle ORM 경로(`db.insert`)로 넣을 때만** 동작한다. raw SQL INSERT는 ID가 안 채워지니 앱 경유 삽입을 전제로 한다.

### 타입

- 손으로 `interface`를 만들지 말고 **스키마에서 추론**한다: `typeof users.$inferSelect` / `$inferInsert`.
- `$inferSelect`(전체 행)는 **"전체 행 기준점 / 읽기 모델 파생 베이스"** 이지, 모든 read의 타입이 아니다.
- 읽기 모델은 **쿼리 핸들러 근처에 per-query로** 정의한다(부분 select 자동 추론 또는 명시적 타입/`Pick`).

---

## 테스트 전략

- 프레임워크: **Vitest**(신규 프로젝트 기본값 — ESM 네이티브, TS 무설정, 빠름).
- **E2E 위주 전략을 허용**한다. 단순 CRUD API에서는 합리적이며, NestJS의 가드/인터셉터/파이프 같은 cross-cutting concern까지 자동 검증된다.
- 단, **복잡한 도메인 로직(분기 多, 상태 머신, 계산 규칙)은 unit test**로 따로 커버한다 — Rich Domain Model로 분리해두면 mock 없이 unit test가 쉬워진다.

---

## 도메인 모델링 가이드

레이어드 아키텍처의 약점은 **Service가 도메인 로직 + 오케스트레이션을 함께** 떠안아 mock 지옥이 되는 것. 기능의 복잡도에 맞춰 레벨을 고른다:

- **Level 0 (단순 CRUD)**: DTO ↔ DB 직접. 도메인 객체 없음. 틀린 게 아니다.
- **Level 1 (규칙 약간) — sweet spot**: Entity에 도메인 메서드 추가(rich) + DTO 분리.
- **Level 2 (도메인이 핵심)**: Domain Entity ↔ Persistence Model 분리 + Mapper.
- **Level 3 (대규모/장기)**: Value Object, Aggregate, Domain Event 등 DDD 풀세트.

원칙:

- **빈약한 모델(anemic) 지양** — 데이터와 행동을 같은 객체에 응집시켜 unit test 가능하게 한다.
- ORM/DB row, HTTP DTO를 그대로 도메인 객체로 쓰지 않는다(책임이 다르다).
