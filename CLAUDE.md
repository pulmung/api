## 프로젝트 개요

- **sikjipsa API** — NestJS 기반 REST API 서버.
- 목적: 최신 기술스택/컨벤션을 학습하며 적용한다. 의사결정마다 "왜"와 "베스트 프랙티스"를 고민하며, 레거시 관성에 의한 결정이 아니라 최신 트렌드와 근거 있는 선택을 우선한다.

---

## 기술 스택

| 영역       | 선택                     | 버전        | 비고                                          |
| ---------- | ------------------------ | ----------- | --------------------------------------------- |
| 런타임     | Node.js                  | 22.x        |                                               |
| 프레임워크 | NestJS                   | ^11.1       |                                               |
| 언어       | TypeScript               | ^6.0        | `strict`, `nodenext` 모듈 해석                |
| 빌드       | SWC (`nest-cli` builder) | —           | `typeCheck: true`로 타입검사 병행             |
| ORM        | Drizzle ORM              | 1.0.0-rc.3  | `drizzle-orm/node-postgres` (v1.0 RC — RQBv2) |
| DB         | PostgreSQL               | (확인 필요) |                                               |
| 검증       | Zod (`zod`)              | ^4.4        | env 검증 + `z.infer` 타입 파생                |
| ID 생성    | `uuidv7`                 | ^1.2        | 앱 레벨 UUIDv7 생성                           |
| 테스트     | Vitest                   | ^4.1        | + Supertest(E2E)                              |

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

---

## 데이터베이스 / Drizzle 컨벤션

### 스키마 파일

- **도메인별로 분리**한다(`user.schema.ts`, `post.schema.ts` …) + `index.ts` barrel에서 모아 re-export.
  - 런타임 `drizzle(pool, { schema })`와 drizzle-kit `schema` 양쪽 모두 barrel을 가리킨다.
- **테이블명 = 복수형**(`users`), **파일명 = 단수형**(`user.schema.ts`).
  - Postgres 예약어 회피(`user`는 예약어) + 프레임워크 관례.

### 네이밍 (casing)

- **코드: camelCase**(`createdAt`) / **DB 컬럼: snake_case**(`created_at`).
- 변환은 **테이블 팩토리(`src/database/schema/table.ts`)** 에 위임한다 → 스키마에서 컬럼명 문자열을 생략한다.
  - `pgTable = pgTableCreator((name) => name, 'snake_case')`. 모든 스키마 파일은 `drizzle-orm/pg-core`가 아니라 **이 `pgTable`** 을 import 한다.
- ⚠️ **drizzle v1.0부터 글로벌 `casing` 옵션이 제거**됐다. 더 이상 `drizzle(pool, { casing })`나 drizzle.config.ts의 `casing: 'snake_case'`로 주지 않는다 — casing은 **스키마(테이블 팩토리)에 단일 소스**로 박는다. (drizzle-kit의 `casing`은 이제 `'camel'|'preserve'`로 pull 방향 전용이다.)

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

## 환경변수 / 설정 (config)

> **한 줄 요약: 환경변수는 신뢰 불가 외부 입력 — 부팅 시 Zod로 검증해 통과 못 하면 서버를 띄우지 않는다(fail-fast). 스키마가 단일 소스, 타입은 `z.infer`로 파생.**

📄 **상세 컨벤션은 [docs/config.md](docs/config.md)에 있다. env 관련 코드(검증 스키마 `src/config/env.validation.ts`, `ConfigService` 소비, `.env.sample`)를 만지기 전에 반드시 그 파일을 읽는다.**
