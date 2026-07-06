# 아키텍처 / 코딩 컨벤션 (architecture)

> 이 문서는 [CLAUDE.md](../CLAUDE.md)의 "아키텍처 / 설계" 상세본이다.
> **`features/` 하위 코드(도메인·유스케이스·어댑터·DTO)를 만지기 전에 읽는다.**

> **한 줄 요약: feature-first + 헥사고날 변형 + CQRS(개념). 의존은 항상 안쪽으로, 추상화는 관성이 아니라 매번 "값"을 계산해서 도입한다.**

> **참조 구현**: 쓰기 — `features/auth` + `features/user` (소셜 회원가입 `POST /auth/signup`) / 읽기 — `features/plant` 사전 조회 (`GET /genera` · `GET /species?genus=`).

> ⚠️ **이 문서는 모든 feature·리소스에 적용되는 *일반 컨벤션*이다.** `auth`/`user`는 원칙이 처음 구현된 **참조 예시**일 뿐 — 앞으로 추가될 리소스(`post`·`comment`·`commerce`…)도 동일 원칙을 따른다. 본문의 특정 클래스·필드명(`User`, `VerifiedIdentity`, `socialProviders` 등)과 `예:` 표기는 **현재 구현 예시**이지 규칙이 아니다. 규칙은 그 위의 리소스-중립적 서술이다.

---

## 0. 의사결정 원칙 (메타)

- 모든 결정에 **"왜"** 를 따진다. 관성·의례로 굳은 패턴을 의심한다.
- 베스트 프랙티스/최신 트렌드를 우선하되 **도그마 없이 케이스마다 비용 대비 값을 계산**한다.
- 추상화(인터페이스·레이어·분리)는 공짜가 아니다 — 간접성·파일 수·인지부하가 비용이다. "지금 이게 필요한가"를 매번 묻는다.
- 필요해지면 그때 도입한다(YAGNI). `extract interface` 같은 건 IDE가 30초에 해준다 — 미리 만들지 않는다.

---

## 1. 레이어 & 의존 방향

```
presentation → application → domain ← (repository | infrastructure)
                       의존은 항상 안쪽(domain)으로
```

| 레이어 | 책임 | 의존 |
| --- | --- | --- |
| **domain** | 엔티티·불변식·도메인 예외·도메인 원시타입 | **import 0** (NestJS·Drizzle·HTTP 모름) |
| **application** | 유스케이스(오케스트레이션). 도메인 조립 | domain + 외부(추상 또는 깨끗한 구현) |
| **repository / infrastructure** | 바깥세상 어댑터(DB·HTTP·JWT) | domain을 구현/참조 |
| **presentation** | HTTP 입출력(controller·dto·filter) | application |

- **리트머스**: domain 파일이 인프라를 import하면 설계 오류다. ORM enum조차 **도메인이 소유**하고 스키마가 거꾸로 참조한다(DIP). 예: `SocialProvider`는 `user/domain`이 소유, `user.schema.ts`가 import.

---

## 2. CQRS (개념만)

- "읽기와 쓰기는 다른 모델을 써도 된다"만 채택. **`@nestjs/cqrs`(CommandBus) 미도입** — 이벤트소싱/비동기 분리가 필요할 때까지 YAGNI.
- **쓰기**: 도메인을 거친다. UseCase = Command 핸들러(`XxxUseCase.execute`). 도메인 엔티티 → `writer`.
- **읽기**: 도메인을 우회한다. `reader`는 **순수 DB 접근**(부분 select, 반환은 추론) — read model 조합을 여기 두지 않는다. 조합 유무로 두 단계가 갈린다:
  - **조합 0** (부분 select가 곧 응답): controller → reader **직행**. 참조 구현: `features/plant` 사전 조회(`GET /genera`·`GET /species?genus=`) — 쿼리 DTO(`@Query() dto`, 글로벌 파이프가 검증), 공개 라우트(무표시), reference-data엔 `Cache-Control`(public + max-age + stale-while-revalidate).
  - **조합 있음** (여러 어댑터 조합·표현 변환): controller → **application 쿼리 서비스** → reader. 참조 구현: `features/plant` 카탈로그 조회(`GET /plants`·`GET /plants/:id`) — `PlantQueryService`가 reader 행 + `PublicFileUrlResolver`(파일 URL)를 read model로 조합. CQRS의 쿼리 핸들러 자리이며, 조합 없는 읽기에 이 레이어를 두면 pass-through 의례다(§0).
- UseCase **1개 = 1 클래스 + `execute`** (동작마다 의존이 다를 때). 의존이 거의 같으면 한 서비스로 묶어도 됨 — 기준은 **의존 응집도**이지 규칙이 아니다.

---

## 3. 모듈 / 폴더 (feature-first)

```
features/<feature>/
  domain/          엔티티·도메인예외·도메인 원시타입 (순수 TS)
  application/     유스케이스 (+ 정말 필요할 때만 포트)
  repository/      쓰기(writer)·읽기(reader) 어댑터    ← DB 접근 (user류)
  infrastructure/  외부연동 어댑터(verifier·issuer)    ← HTTP·JWT (auth류)
  presentation/    controller · dto/ · (filter)
  <feature>.module.ts
```

- **엔티티 소유권**: 엔티티는 "그것을 가장 오래·가장 많이 책임지는 컨텍스트"가 소유한다. (예: `User`는 `user`가 소유, `auth`는 *사용*만.)
- **모듈 간 의존**: 순환 없이 **"사용하는 쪽 → 소유하는 쪽"** 한 방향. 양방향 참조가 필요하면 모듈 경계가 틀렸다는 신호. (예: auth가 User를 쓰므로 `auth → user`.)
- 모듈 경계를 넘겨 쓰려면 **`exports`로 공개**한다. (예: `UserModule` exports `UserWriter`.)
- **단순함 우선**: 한 리소스를 여러 엔티티/테이블로 쪼개는 것은 요구가 실제로 생길 때 도입한다(YAGNI). (예: `User=계정` 통합모델을 택하고, 멀티소셜 연결이 필요해지면 그때 `SocialAccount`로 분리.)
- `domain/` 밑에 repository/infra를 두지 않는다(도메인 순수성 오염).

---

## 4. 포트(interface) vs 구현 직접 — 판단 기준

- **핵심**: 경계의 본질은 `interface` 키워드가 아니라 **"public 시그니처가 도메인 언어인가"** 다. ORM/HTTP 타입이 시그니처에 새면 인터페이스가 있어도 무의미(leaky = 비용만, 이득 0).
- 인터페이스는 **값을 할 때만** 도입한다:
  - 새 구현 추가가 잦다(OCP 플러그인 확장)
  - **모듈 경계 공개 계약**
  - 테스트에서 전체를 갈아끼워야 한다
- 구현 1개 + 교체 계획 없음 + E2E 테스트 → **구현 직접**(클래스가 곧 DI 토큰, `Symbol` 불필요).
- **신뢰는 타입이 아니라 런타임이 준다**: 인터페이스는 컴파일 타임 약속일 뿐. 외부 입력의 진짜 보증은 경계의 Zod 검증이다(§8).
- 참조구현: `UserWriter`·`SocialIdentityVerifier`·`JwtTokenIssuer` 모두 구현 직접 — 같은 원칙을 케이스마다 계산한 결과다.

---

## 5. 타입: 추론 vs 명시

- **경계(함수 반환·공개 계약·모듈 간 데이터) → 명시.** 구현 실수가 조용히 새는 걸 막고, 에러를 근원에 가둔다.
- **내부(지역변수·중간값·읽기 모델) → 추론.** 이중 관리를 없앤다(스키마 `$inferSelect`, `z.infer`와 같은 철학).
- 의례적 명시는 피한다. 추론으로 충분하면 추론. 단 **외부로 흐르는 응답 계약**은 명시가 안전하다(codegen에 전파되므로).

---

## 6. 도메인 모델링

- 엔티티: **`private constructor` + 정적 팩토리**(`User.register`). 불변식을 한 곳에 응집 → "유효하지 않은 상태를 표현 불가능"하게.
- **자기완결적 불변식**(닉네임 형식)은 엔티티가. **컨텍스트 의존 규칙**(전역 유니크)은 DB 제약 + repository가 — 엔티티 혼자선 알 수 없다.
- 도메인 예외: 공통 `abstract DomainError` 베이스(`code` + `status` 보유) + 구체 클래스. **`HttpException` 상속 금지**(NestJS 클래스 결합 회피) — 단 `code`(machine-readable 도메인 식별자) + `status`(HttpStatus)는 예외가 **자기 모듈 안에서 소유**한다. 에러를 모듈에 응집시켜 전역 errorCode 카탈로그·필터 매핑 테이블을 없애기 위함. (status 숫자 보유 ≠ HttpException 상속 — 다른 전송이면 어댑터가 다시 매핑하면 그만. REST-only에선 이 "HTTP 인지"가 모듈 응집을 위한 실용적 타협.)
- **errorCode 단일 소스**: `code`는 구체 예외 **한 곳**에만 리터럴로 둔다. 전역 카탈로그로 모으지 않는다(feature-first 역행 — DTO 거대 묶음과 같은 안티패턴). HTTP 변환은 글로벌 필터(§13)가 예외의 `status`를 **직렬화만** 한다(매핑 테이블 없음 → 새 예외에도 필터 수정 0).

---

## 7. 영속성 & 에러 처리

- **DB 유니크 제약이 신뢰의 원천.** 사전 SELECT 금지 — INSERT 후 충돌(`23505`)을 잡아 도메인 예외로 변환(race-safe + 1쿼리).
- drizzle v1.0은 쿼리 에러를 `DrizzleQueryError`로 **wrap**하고 원본 `pg.DatabaseError`는 `.cause`에 둔다 → `const cause = e instanceof DrizzleQueryError ? e.cause : e`로 꺼낸 뒤 `cause instanceof DatabaseError && cause.code === '23505'` + `cause.constraint`로 분기. 제약엔 **명시적 이름** 부여(자동 네이밍 의존 회피, 상수로 단일 소스화). ⚠️ raw pg 전파가 아니라 wrap이므로 `.cause` 추출이 필수 — E2E로 발견한 실제 동작이다.
- 두 충돌(닉네임 중복 vs 이미 가입)을 클라가 다르게 처리해야 하면 구분, 아니면 단일 `ConflictError`로 단순화.
- **모르는 에러는 rethrow** — 삼키지 않는다(필터가 500).

---

## 8. 외부 연동 (어댑터)

- 외부 응답(소셜 HTTP)·env는 **신뢰 불가 입력 → Zod로 파싱**한다([config.md](config.md) 철학).
- 어댑터가 provider별 raw 응답을 **공통 형태로 정규화**한다(`VerifiedIdentity`). usecase는 provider 종류를 모른다 — 응답이 다를수록 정규화가 usecase를 보호한다.
- `fetch`(native, 의존성 0) + `AbortSignal.timeout`. **출처 검증을 신원 조회보다 먼저**([social-auth.md](social-auth.md)).

---

## 9. DTO & presentation

- **endpoint별 작은 파일.** 모듈 거대 묶음(`auth.request.ts`에 전부)·`request/`·`response/` 폴더 분리 금지(feature-first 역행). 분류가 필요하면 폴더가 아니라 **파일명 suffix**.
- **응답 공유 기준 = "변경 이유가 같은가"**. 같으면 공유(`AuthTokensDto`를 login/signup/refresh가), 다르면 분리.
- **생성(POST) 201 응답 = 그 리소스의 조회 표현**(REST 관례: 201 body ≒ GET 표현). 별도 "생성 응답 DTO"를 만들지 않고 조회 DTO를 재사용하며, 컨트롤러가 생성 직후 reader로 재조회해 반환한다 — 쿼리 1개를 내고 생성/조회 표현의 이원화를 구조적으로 차단. (예: POST /plants·GET /plants/:id가 `PlantDetailDto` 공유.)
- 모듈 간 응답 중첩 회피 → 순환 방지장치(`base.response`)가 애초에 불필요. 각 DTO는 자기 endpoint의 계약(optional 떡칠 만능 DTO 금지 = 거짓말 금지).
- nestjs-zod: 요청 `createZodDto` + 글로벌 `ZodValidationPipe`. 응답 **`@ZodResponse`**(직렬화 + OpenAPI 문서 + 컴파일 반환검증, 공식 권장 / `@ZodSerializerDto`보다 우위). 문서화는 `.meta({ description, example })` / `.describe()`.
- **셀렉트박스/상수 목록의 공급 기준 = "변경이 어느 배포 트레인을 타는가"**: 코드 배포와 함께만 변하는 **닫힌 enum**(예: `plantCategories`)은 런타임 API를 만들지 않는다 — 스펙의 enum → codegen으로 전달. 운영 중 배포 없이 변하는 **열린 사전**(예: genera/species, admin 큐레이션)은 reference-data 조회 API로 전달. 사용처 개수는 판단 축이 아니다.
- **여러 DTO가 공유하는 enum은 named component로**: 공유 zod 스키마 **단일 인스턴스**에 `.meta({ id: 'XxxYyy' })` → `cleanupOpenApiDoc`이 `components.schemas`로 호이스팅하고 사용처를 `$ref`로 바꾼다. DTO마다 `z.enum(...)`을 따로 만들면 스펙에 인라인 복제 → codegen이 익명 타입을 여러 개 생성. ⚠️ `.meta({ id })` 인스턴스가 둘이면 duplicate-id 에러 — 반드시 한 파일에서 export해 재사용. (참조 구현: `features/plant/presentation/dto/plant-category.schema.ts` — zod ≥4.4 × nestjs-zod 5.4의 input 쪽 리네임 드리프트 주석 포함.)
- `additionalProperties: false`("forbidden")는 **정상이자 자산** — 정확한 계약 + 누출 방지 + codegen 정확성. 유지.

---

## 10. 토큰 / 보안

**발급**

- JWT payload는 **최소**(`{ sub: user.id }`). 자주 변하는 것(닉네임)·민감정보 금지(base64라 디코드된다).
- `secret`·`expiresIn`은 `JwtModule.registerAsync`에 한 번 설정, `sign`은 payload만. `JwtModule`은 **`global: true`** — 가드가 다른 feature 모듈의 라우트에서 `UseGuards`로 붙으므로 `JwtService`가 어디서든 resolve돼야 한다.
- 클라가 보낸 신원 불신 — 검증된 값(`identity`)만 진실로 사용([social-auth.md](social-auth.md)).

**검증 (access token 가드)** — `JwtAuthGuard`(`features/auth/infrastructure/`)가 발급의 역.

- **무상태 검증**: 서명 + 만료 + **알고리즘 고정(`algorithms: ['HS256']`)** 만 확인하고 `sub`를 신뢰 → `req.user = { id }`. 매 요청 DB 조회 없음(폐기/밴은 refresh 경계의 DB 세션이 책임 — access는 짧게 산다). 실패는 형태 불문 **단일 `UnauthenticatedError`(401)** 로 통일(만료/위조 구분 안 함 = oracle 회피). `sub`가 문자열이 아니면 거부.
- **가드는 opt-in — 전역 `APP_GUARD`가 아니다**(§13). 라우트에 데코레이터로 붙인다(`features/auth/presentation/`):
  - `@Authenticated()` = `UseGuards(JwtAuthGuard)` + `@ApiBearerAuth()` + `@ApiErrors(UnauthenticatedError)` 합성 → **가드(enforcement) + OpenAPI 문서**를 한 데코로. 보호 라우트에.
  - `@OptionalAuth()` = 위 + `SetMetadata(IS_OPTIONAL_AUTH_KEY)` → 토큰 없으면 익명 통과, 있으면 검증(잘못됐으면 401).
  - **공개 라우트 = 무표시**(데코 0). → 라우트당 데코 하나, 공개는 clean, 이중 애노테이션 0.
- **왜 opt-in인가**: 전역 가드(secure-by-default)면 ① 공개마다 `@Public` opt-out + 보호마다 문서용 데코 = **이중 애노테이션**, ② 보호가 컨트롤러에 안 보이는 **암묵 동작**이 생긴다(명시 > 마법). 인증은 라우트마다 공개/보호/선택이 갈리는 **라우트 단위 결정**이라 opt-in.
  - ⚠️ **트레이드오프**: opt-in은 `@Authenticated` 누락 시 **fail-open**(전역 가드는 fail-closed). "의도치 않게 열린 라우트 없음" 불변식을 **리뷰 + (라우트가 늘면) allowlist 테스트**로 지킨다 — 전역 가드가 *구조로* 준다면 opt-in은 *테스트로* 준다.
- `@CurrentUser()`(`common/auth/`, `AuthUser` 타입 공유)로 컨트롤러가 `req.user`를 타입 안전하게 꺼낸다. 공개/optional 라우트에선 `undefined` 가능 → 반환 타입 `AuthUser | undefined`.

---

## 11. 데이터 수집

- 저장 항목은 **"우리 도메인이 필요로 하는 것"** 이 정한다(provider 응답이 아니라). **수집 가능 ≠ 수집해야** — 최소수집(개인정보보호법).
- 정말 필요하면 모든 유저에게 **일관 수집**한다(provider 비대칭에 기대지 않는다).

---

## 12. 네이밍

- `UPPER_SNAKE`: 매직 원시값·문자열 상수·DI 토큰 (`DRIZZLE`, `UNIQUE_USERS_NICKNAME`).
- `camelCase`: 데이터 배열 + 파생타입 패턴 (`socialProviders` ↔ 타입 `SocialProvider`).
- **wire 값**(API·DB에 나가는 식별자, 예: provider id): 그 도메인의 통용 표기 — OAuth provider는 **소문자**(`'kakao'`, `'google'`).
- DB casing(코드 camelCase ↔ DB snake_case)·테이블 복수형/파일 단수형은 [CLAUDE.md](../CLAUDE.md) 참조.

---

## 13. 앱 레벨 횡단 (글로벌 프로바이더)

> 검증·직렬화·예외매핑은 **`app.module`에 글로벌로 한 번** 등록한다. feature는 데코레이터로만 참여하고, 컨트롤러·유스케이스엔 그 boilerplate를 두지 않는다.

| 토큰 | 등록 | 역할 | feature가 참여하는 법 |
| --- | --- | --- | --- |
| `APP_PIPE` | `ZodValidationPipe` | 요청 `@Body`/`@Query`를 DTO 스키마로 **검증** (실패 시 400) | `@Body() dto: XxxDto` (`createZodDto`) |
| `APP_INTERCEPTOR` | `ZodSerializerInterceptor` | 응답을 DTO 스키마로 **직렬화**(strip → 누출 방지) | `@ZodResponse({ type: XxxDto })` |
| `APP_FILTER` | `GlobalExceptionFilter` (`@Catch()` catch-all) | **모든 예외의 최후 방어선** — `DomainError`는 `status`+`errorCode` 직렬화 / `HttpException`은 그대로 / 미처리는 500 + 구조화 로깅 | 도메인 예외를 `throw` (잡지 않음) |

- **컨트롤러·유스케이스는 수동 검증/직렬화/try-catch를 하지 않는다** — 위 3개가 횡단으로 처리한다. 컨트롤러는 얇게 유지된다.
- `GlobalExceptionFilter`는 `@Catch()`(catch-all, `common/filters/`)라 **새 예외가 생겨도 필터 수정 0** — `DomainError`를 상속하고 `code`+`status`만 주면 자동 처리된다(§6). 미처리(unexpected) 에러만 request 메타와 함께 로깅하고, **스택은 클라에 노출하지 않는다**(보안). 도메인/`HttpException`은 "예상된" 에러라 로깅하지 않는다(노이즈 방지).
- **에러 응답 형태 통일**: `{ statusCode, errorCode, message }`. 클라(codegen)가 `errorCode`로 분기한다.
- **에러 OpenAPI 문서화**: 글로벌 필터의 응답은 정적 분석이 안 되므로, 엔드포인트가 던지는 도메인 예외를 `@ApiErrors(...예외클래스)`(`common/swagger/`)로 선언 → status별 `errorCode` enum이 스펙에 박혀 codegen으로 프론트에 전달된다. **엔드포인트별 응답 클래스를 손으로 만들지 않는다**(보일러플레이트 회피).
- 글로벌 등록 위치는 `app.module`의 `providers`. OpenAPI 스펙 노출(codegen 단일 소스)은 `main.ts`의 Swagger 설정이며, 글로벌 직렬화와 별개다.
- 횡단으로 올릴지 feature 로컬에 둘지 기준: **앱 전체에 일관 적용돼야 하면 글로벌**(`APP_*`), 특정 라우트에만 필요하면 데코레이터/로컬. (검증·직렬화·도메인예외 매핑은 전자.)
- **인증(auth) 가드는 이 표에 없다 — 의도적으로 opt-in**이다. 위 3개(검증·직렬화·예외매핑)는 앱 전체에 일관 적용돼야 해서 글로벌이지만, **인증은 라우트마다 공개/보호/선택이 갈리는 라우트 단위 결정**이라 `@Authenticated()`/`@OptionalAuth()` 데코레이터로 붙인다. 전역 `APP_GUARD`로 올리지 않는다(이유·트레이드오프는 §10).
