## 프로젝트 개요

- **pulmung API** — NestJS 기반 REST API 서버.
- 목적: 최신 기술스택/컨벤션을 학습하며 적용한다. 의사결정마다 "왜"와 "베스트 프랙티스"를 고민하며, 레거시 관성에 의한 결정이 아니라 최신 트렌드와 근거 있는 선택을 우선한다.

---

## 기술 스택

| 영역       | 선택                     | 버전        | 비고                                           |
| ---------- | ------------------------ | ----------- | ---------------------------------------------- |
| 런타임     | Node.js                  | 22.x        |                                                |
| 프레임워크 | NestJS                   | ^11.1       |                                                |
| 언어       | TypeScript               | ^6.0        | `strict`, `nodenext` 모듈 해석                 |
| 빌드       | SWC (`nest-cli` builder) | —           | `typeCheck: true`로 타입검사 병행              |
| ORM        | Drizzle ORM              | 1.0.0-rc.3  | `drizzle-orm/node-postgres` (v1.0 RC — RQBv2)  |
| DB         | PostgreSQL               | (확인 필요) |                                                |
| 검증       | Zod (`zod`)              | ^4.4        | env 검증 + `z.infer` 타입 파생                 |
| ID 생성    | `uuidv7`                 | ^1.2        | 앱 레벨 UUIDv7 생성                            |
| 테스트     | Vitest                   | ^4.1        | + Supertest(E2E)                               |
| 로깅       | Pino (nestjs-pino)       | ^10 / ^4.6  | 구조화 JSON · stdout. pino-http 요청 자동 로깅 |

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
npm run db:seed          # 사전(genera/species) 시드 — insert-only 멱등, 재실행 안전

# OpenAPI (codegen 단일 소스)
npm run openapi:generate # openapi.json 재생성
npm run openapi:check    # 생성 + git diff로 드리프트 검출 (CI용)
```

> ⚠️ **DTO·컨트롤러·`@ApiErrors`를 바꿨으면 `openapi:generate`를 재실행해 openapi.json을 같은 커밋에 포함한다.** 스펙이 낡은 채 커밋되면 프론트 codegen이 낡은 계약을 받는다 (실제 사고 사례: 3e655e1 — example 변경 후 미재생성).

---

## 디렉토리 구조

### 인프라 (DB)

```
src/database/
  schema/
    user.schema.ts        # 도메인별 테이블 정의
    index.ts              # barrel: 모든 스키마 re-export (drizzle()에 전달)
  seed/                   # reference data 시드 (데이터 = 코드, PR로 큐레이션)
    plant-dictionary.data.ts   # 속/종 사전 스타터 데이터
    plant-dictionary.seed.ts   # apply 함수 (insert-only 멱등, 자기 트랜잭션)
    run.ts                # 엔트리 — dev: tsx / prod: node dist/database/seed/run.js
  drizzle.constants.ts    # 주입 토큰(DRIZZLE) + DB 타입(DrizzleDB)
  drizzle.module.ts       # @Global 모듈, pg.Pool 기반 커넥션 제공
drizzle.config.ts         # (루트) drizzle-kit CLI 설정
```

---

## 아키텍처 / 코딩 컨벤션

> **한 줄 요약: feature-first + 헥사고날 변형 + CQRS(개념). 의존은 항상 안쪽으로, 추상화는 관성이 아니라 매번 "값"을 계산해서 도입한다.**

📄 **상세는 [@docs/architecture.md](docs/architecture.md)에 있다. `features/` 하위 코드(도메인·유스케이스·어댑터·DTO)를 만지기 전에 반드시 읽는다.** 참조 구현: `features/auth` + `features/user` (소셜 회원가입 `POST /auth/signup`).

### feature 구조 (요약)

```
src/features/<feature>/
  domain/          순수 TS — 엔티티·도메인예외·도메인 원시타입 (import 0)
  application/     유스케이스(오케스트레이션) (+ 정말 필요할 때만 포트)
  repository/      쓰기(writer)·읽기(reader) 어댑터    ← DB (user류)
  infrastructure/  외부연동 어댑터(verifier·issuer)    ← HTTP·JWT (auth류)
  presentation/    controller · dto/ · (filter)
  <feature>.module.ts
```

- 의존 방향: `presentation → application → domain ← infra`. 모듈 간 횡단은 **"사용 → 소유"** 한 방향 (예: `auth → user`).
- 엔티티는 "가장 오래 책임지는 컨텍스트"가 소유한다 (예: `User` = user). 경계를 넘겨 쓰려면 `exports`로 공개.

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

### 정렬 (collation)

> **한 줄 요약: collation은 쿼리가 아니라 DB 레벨에 선언한다 — 모든 환경의 DB는 builtin `C.UTF-8`로 생성한다(PG 17+). 쿼리에 `COLLATE "C"`를 명시하지 않는다.**

- **왜 DB 기본값을 바꾸나**: glibc `en_US.utf8` 같은 언어별 collation은 ① 한글을 가나다순으로 정렬하지 **않고**('아단소니' < '델리시오사' — E2E로 발견한 실제 동작), ② prefix `LIKE 'abc%'`가 B-tree 인덱스를 못 타며, ③ OS(glibc) 업그레이드 시 정렬 규칙이 바뀌어 **인덱스가 조용히 깨질 수 있다**. builtin `C.UTF-8`은 코드포인트 정렬(= 완성형 한글 가나다순, 버전 불변) + 유니코드 ctype(`lower`/`ILIKE`가 비ASCII에도 동작)으로 세 문제를 모두 없앤다.
- **왜 per-query/컬럼이 아니라 DB 레벨인가**: 쿼리마다 `COLLATE "C"`는 "잊지 말아야 하는 규칙"(fail-open)이고 기본 인덱스도 못 탄다. 기본값이 옳으면 규칙이 필요 없다.
- **환경 프로비저닝** (DB 생성 시점에만 지정 가능 — 사후 변경은 재생성):
  - 로컬 docker: `-e POSTGRES_INITDB_ARGS='--locale-provider=builtin --builtin-locale=C.UTF-8'`
  - E2E: `test/helpers/setup-e2e.ts`의 `createPostgresContainer()`가 동일 설정 적용 — **컨테이너를 직접 띄우는 테스트도 반드시 이 팩토리를 쓴다.**
  - 운영(RDS 등): DB 생성 시 동일하게 지정 (RDS는 PG 17+에서 builtin provider 지원).
- 진짜 언어학적 정렬(예: 다국어 사전식)이 필요해지는 특정 쿼리만 그때 ICU collation을 **명시적으로** 붙인다.

### 시드 (reference data)

- 큐레이션 사전(genera/species 등)은 **마이그레이션·부팅 훅이 아니라 독립 스크립트**(`src/database/seed/`)로 넣는다. 데이터는 TS 파일 = 코드(PR 리뷰), `npm run db:seed`.
- **insert-only 멱등**(`onConflictDoNothing`, 단일 트랜잭션): 재실행 = 누락분만 추가. update/delete 안 함 — admin이 테이블을 공동 소유하게 되므로. ⚠️ admin이 지운 baseline 행은 재시드 시 부활(admin 도입 전까지 수용).

### 타입

- 손으로 `interface`를 만들지 말고 **스키마에서 추론**한다: `typeof users.$inferSelect` / `$inferInsert`.
- `$inferSelect`(전체 행)는 **"전체 행 기준점 / 읽기 모델 파생 베이스"** 이지, 모든 read의 타입이 아니다.
- 읽기 모델은 **쿼리 핸들러 근처에 per-query로** 정의한다(부분 select 자동 추론 또는 명시적 타입/`Pick`).

---

## 환경변수 / 설정 (config)

> **한 줄 요약: 환경변수는 신뢰 불가 외부 입력 — 부팅 시 Zod로 검증해 통과 못 하면 서버를 띄우지 않는다(fail-fast). 스키마가 단일 소스, 타입은 `z.infer`로 파생.**

📄 **상세 컨벤션은 [docs/config.md](docs/config.md)에 있다. env 관련 코드(검증 스키마 `src/config/env.validation.ts`, `ConfigService` 소비, `.env.sample`)를 만지기 전에 반드시 그 파일을 읽는다.**

---

## 테스트 (test)

> **한 줄 요약: 각 관심사를 "가장 싸게 신뢰를 주는 레벨"에서 테스트한다 — 구조(도메인 응집)가 _어디서_ 테스트할지를 결정한다. E2E 백본은 필수, 엣지는 unit으로.**

📄 **상세는 [docs/testing.md](docs/testing.md)에 있다. 테스트 코드를 작성/추가하기 전에 읽는다.** unit·통합은 `*.spec.ts` **co-location**, E2E는 `test/*.e2e-spec.ts`. 러너는 **Vitest**(globals 미사용, `import`), 외부 API mock은 **MSW**.

---

## 로깅 / 관측가능성 (logging)

> **한 줄 요약: 구조화 JSON 로깅(pino) — "읽을 것만 남긴다"가 아니라 "질의할 수 있게 담는다". 요청 상관관계는 reqId, 자격증명은 redact, dev만 pretty·prod는 stdout JSON. 알림·메트릭·트레이싱은 의도적으로 미룸.**

📄 **상세는 [docs/logging.md](docs/logging.md)에 있다. 로깅 설정(`src/common/logger/logger.config.ts`)·예외 필터 로깅을 만지기 전에 읽는다.**

---

## 파일 업로드 (file)

> **한 줄 요약: stateless presign — files 원장 테이블 없이(의도적 폐기, 되살리지 말 것) S3 presigned POST의 policy가 업로드 시점에 크기·타입·키를 강제하고, 파일 메타는 소비처 도메인 jsonb에 인라인. 버킷은 접근등급별 분리, CloudFront signed URL은 읽기 경로 전용.**

📄 **상세(확정 결정·버킷 전략·private 확장 계획·seam 목록)는 [docs/file-upload.md](docs/file-upload.md)에 있다. `features/file` 코드 또는 파일을 첨부받는 소비처 feature(plant·chat 등)를 만지기 전에 반드시 읽는다.**
