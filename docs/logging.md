# 로깅 / 관측가능성 (logging)

> 이 문서는 [CLAUDE.md](../CLAUDE.md)의 "로깅" 상세본이다. **로깅 설정(`src/common/logger/logger.config.ts`)·예외 필터 로깅을 만지기 전에 읽는다.**

> **한 줄 요약: 구조화 JSON 로깅(pino) — "읽을 것만 남긴다"가 아니라 "질의할 수 있게 담는다". 요청 상관관계는 reqId, 자격증명은 redact, dev만 pretty·prod는 stdout JSON. 알림·메트릭·트레이싱은 의도적으로 미룸([todo.md](todo.md)).**

> ⚠️ 본문의 특정 필드·키명(`accessToken`, `reqId` 등)은 **현재 구현 예시**다. 규칙은 그 위의 리소스-중립적 서술이다.

---

## 0. 기조 — 읽기가 아니라 질의

- "안 볼 거면 왜 로깅하냐"의 **절반은 옳다**(목적 없는 노이즈 로그 금지 — 모든 라인엔 이유가 있어야). **절반은 스케일에서 깨진다**: 예상치 못한 장애는 *무슨 질문을 하게 될지 미리 모른다*(unknown unknowns). 그래서 풍부한 구조화 컨텍스트를 미리 담아 **읽지 말고 질의(query)** 한다.
- **캡처 / 알림 / 읽기는 다른 일이다.** 로그를 그대로 Slack에 흘리면 셋이 섞여 알림 폭주. **캡처는 넓게, 알림은 집계 신호에 좁게.**
- 비용(볼륨)의 레버는 "이벤트당 컨텍스트 줄이기"가 아니라 **샘플링(에러 100%, 성공 샘플) + 보존 티어**다. (미룸 → [todo.md](todo.md))

---

## 1. 스택 — 왜 pino

| 패키지 | 역할 | 종류 |
| --- | --- | --- |
| `pino` | JSON-first·저할당 로거 코어 | dep |
| `pino-http` | 요청/응답 자동 로깅 + reqId 전파(AsyncLocalStorage) | **peer** (직접 명시) |
| `nestjs-pino` | NestJS 어댑터(`LoggerModule`) | dep |
| `pino-pretty` | dev 전용 사람 친화 출력 | devDep |

- **vs Winston**: pino가 JSON-first + 훨씬 빠름(transport를 워커스레드 비동기). Winston의 multi-transport 라우팅은 실제로 필요해질 때까지 비용만 → YAGNI.
- `pino`/`pino-http`는 nestjs-pino의 **peerDependency** = "호스트 앱이 버전을 소유". transitive에 기대지 않고 `dependencies`에 **명시**한다.

---

## 2. 구성 (3곳)

| 파일 | 역할 |
| --- | --- |
| `src/common/logger/logger.config.ts` | `LoggerModule.forRootAsync` — `level`·`genReqId`·`redact`·`serializers`·`transport` |
| `src/main.ts` | `NestFactory.create(AppModule, { bufferLogs: true })` + `app.useLogger(app.get(Logger))` |
| `src/app.module.ts` | `imports`에 `loggerModule` (ConfigModule 다음) |

- `useLogger`가 `@nestjs/common`의 `Logger` 전역까지 갈아끼움 → `new Logger(ctx)`(예: 예외 필터)도 **자동으로 pino를 탄다**(코드 수정 0).
- `bufferLogs`: LoggerModule 준비 전 부트스트랩 로그를 버퍼→재생(첫 줄부터 일관, 유실 0).

---

## 3. 핵심 설정 결정

| 항목 | 결정 | 왜 |
| --- | --- | --- |
| `level` | 검증된 env `LOG_LEVEL` ([config.md](config.md)) | 단일 소스·fail-fast. dev=`debug`, prod=`info`(prod-safe 기본) |
| `genReqId` | `x-request-id` 있으면 이어받고, 없으면 `uuidv7()` 생성 + 응답 헤더 에코 | 게이트웨이/타 서비스 추적을 이어받음. 기본 메모리 카운터 대신 **전역유일 + 시간순** |
| `redact` | **키 이름 와일드카드** (`*.authorization`, `*.accessToken` …) | body·header 어디 있든, 새 엔드포인트가 생겨도 **자동 커버** |
| `serializers` | req/res를 핵심 필드만(`id`·`method`·`url` / `statusCode`) | 헤더 전체 덤프 제거(노이즈·비용·PII) |
| `transport` | dev=`pino-pretty`, prod=`undefined`(stdout JSON) | **12-factor**: 앱은 stdout만, 수집은 플랫폼이(파일 transport 금지) |

---

## 4. 요청 상관관계 (reqId)

- 한 요청의 모든 로그 라인이 같은 `reqId`를 단다 → 장애 추적의 기본.
- **AsyncLocalStorage** 기반(nestjs-pino) → `new Logger()`·`PinoLogger`가 **request-scoped provider 없이** 현재 요청 컨텍스트에 자동으로 묶임.
- ⚠️ 로깅을 위해 provider를 `Scope.REQUEST`로 만들지 않는다 — 요청마다 DI 재생성 = 성능 붕괴.
- 예외 필터 로그도 같은 reqId → **[접근로그(슬림) + 에러로그(풀)]이 reqId로 묶인다.**

---

## 5. 예외 필터 로깅 (`global-exception.filter.ts`)

- **기대된 에러는 로깅하지 않는다**(노이즈): `DomainError`(4xx 도메인)·`HttpException`(검증 등). → [architecture.md](architecture.md) §13.
- **unexpected(미처리)만** 전체 컨텍스트로 남긴다:
  - `err: exception` → pino `err` serializer → `{ type, message, stack }`. **스택은 서버 로그에만**(클라 응답은 `Internal Server Error` — 보안).
  - `method·url·params·query·headers·body` 전부 → 디버깅 풀 컨텍스트(자격증명은 `redact`가 가림).
  - 이 키들은 top-level이라 §3의 `req`/`res` serializer가 **안 건드림**(serializer는 `req`/`res` 키에만 작동).
- **모르는 에러는 rethrow**(삼키지 않음) — 삼키면 필터로 안 올라와 단일 길목이 무력화된다.

---

## 6. 민감정보 — allowlist > denylist

- **serializer = allowlist**("이것만 로깅") = 1차 방어. **redact = denylist**("이건 가림") = 안전망. **둘 다 둔다.**
- 새 자격증명 body 필드가 생기면 **키 이름을 `redact`에 추가**(단일 소스). 현재: `accessToken`(소셜 토큰), `refreshToken`(자체), 헤더 `authorization`·`cookie`. 미래 대비로 `password`·`idToken`·`secret`도 포함.
- pino가 JSON 인코딩 시 개행/제어문자를 이스케이프 → **로그 인젝션 자동 방어**.

---

## 7. 안티패턴

- ❌ 평문 문자열에 변수 보간(`'user ' + id`) → 질의 불가. 메타데이터는 **객체로**.
- ❌ `console.log` — 레벨·구조·전파 없음.
- ❌ 로깅 위해 request-scoped provider.
- ❌ `try/catch`로 에러 삼킴 → 필터 우회.
- ❌ 기대된 도메인 예외를 error 레벨로(노이즈).

---

## 8. 미룬 것 (관측·알림)

구조화 로깅까지가 현 범위다. 알림·메트릭·트레이싱은 **씨앗만 심고 의도적으로 미룸**(각자 "그날 30분"짜리 additive) → [todo.md](todo.md). 비싼(retrofit 어려운) 것은 이미 박았다: **구조화 JSON · 단일 에러 길목 · reqId · stdout · OTel 호환 필드명.**
