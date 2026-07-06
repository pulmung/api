# 테스트 전략 (testing)

> 이 문서는 [CLAUDE.md](../CLAUDE.md)의 "테스트" 상세본이다. **테스트 코드를 작성/추가하기 전에 읽는다.**

> **한 줄 요약: 각 관심사를 "가장 싸게 신뢰를 주는 레벨"에서 테스트한다. 구조(도메인 응집)가 *어디서* 테스트할지를 결정한다.**

> ⚠️ 본문의 특정 클래스명(`User.register`, `SocialIdentityVerifier` 등)은 **현재 구현 예시**다. 규칙은 그 위의 리소스-중립적 서술이며, 앞으로 추가될 모든 feature·테스트에 동일하게 적용된다.

---

## 0. 기조

- **"API가 계약대로 동작한다"는 신뢰는 E2E가 준다** — E2E 백본(happy + 인증 + 주요 에러)은 필수다.
- 하지만 **"모든 엣지케이스를 E2E로"는 안티패턴**이다(느림 · 실패 진단 비용↑). 그건 레이어드에서 도메인이 service에 흩어져 unit이 mock 지옥이라 *E2E로 도망간 증상*이다. 도메인을 응집시키면(우리 구조) 엣지를 **unit으로 싸게** 잡는다.
- **"의미 없는 repo 호출 unit"도 안티패턴**이다(커버리지 숫자 채우기, mock이 mock을 검증).
- 성숙한 빅테크 = **적절한 믹스**(Google "Test Sizes" / Testing Trophy). 정답은 *"각 관심사를 최소 비용으로 신뢰를 주는 레벨에서"*이지, "전부 E2E"도 "전부 unit"도 아니다.

---

## 1. 레벨별 전략 (무엇을 어디서)

| 레벨 | 대상 | mock | 도구 | 예 |
| --- | --- | --- | --- | --- |
| **도메인 단위** (다수) | 도메인 모델의 비즈니스 규칙·불변식 | **0** | Vitest | `User.register` 닉네임 형식·경계 |
| **어댑터 단위/통합** | 어댑터가 외부와 실제로 동작하는지 | 외부만 | Vitest + MSW / testcontainers | verifier(HTTP mock) · writer(실제 DB 23505) |
| **E2E** (백본) | API 계약 — happy + 인증 + 주요 에러 | 외부 HTTP만 stub | supertest + testcontainers | `POST /auth/signup` 성공/401/409/422 |

- **Integration은 E2E가 커버하면 생략**한다(중복 회피). 단 외부 HTTP(소셜)는 E2E에서도 실제 호출 불가 → stub/override.

---

## 2. 무엇을 어느 레벨에 — 판단 기준

- **순수 로직 엣지**(형식 검증, 정규화, 계산) → **unit**. (E2E로 짜면 HTTP 요청 수십 개; unit은 밀리초.)
- **외부 의존(HTTP·DB)과의 상호작용** → integration 또는 E2E.
- **보안 엣지**(출처검증 등 *실제 토큰이 있어야 하는* 시나리오) → **unit + mock**. E2E로는 불가능(진짜 provider 토큰 필요).
- **타입 계약(요청/응답 형태)** → 테스트가 아니라 **OpenAPI codegen**이 컴파일 타임에 잡는다. E2E는 *런타임 동작*(인증·규칙·errorCode)만 검증.

---

## 3. 파일 위치

- **unit / 통합**: **co-location** — 소스 옆 `*.spec.ts` (예: `user.ts` 옆 `user.spec.ts`). 소스-테스트가 함께 움직이고, 테스트 없는 파일이 드러난다.
  - 시각적 "지저분함"은 **VSCode file nesting**(`.vscode/settings.json`)으로 `*.spec.ts`를 소스 아래 접어 해소.
- **E2E**: `test/` 디렉토리 `*.e2e-spec.ts` (시스템 전체라 특정 모듈에 안 매임).
- **빌드 제외**: `tsconfig.build.json`의 `exclude`에 `**/*spec.ts` → `dist`에 테스트 미포함.

---

## 4. 도구

- **러너: Vitest.** globals 미사용 → `import { describe, it, expect } from 'vitest'` (tsconfig `types: ["node"]`). 설정 파일 없이 기본값으로 `*.spec.ts` 자동 발견.
- **외부 API mock: MSW.** `vi.fn()`으로 `fetch`를 직접 mock하는 것보다 우위 — **HTTP 레이어에서 가로채** 실제 fetch 코드(URL·헤더·타임아웃)는 그대로 돌고 *응답만* 가짜. 더 현실적이고 `nock`을 대체한 표준.
  - `setupServer()` + `server.listen({ onUnhandledRequest: 'error' })` → **mock 누락 = 즉시 실패**(실수로 실제 API 호출/URL 오타 방지). `afterEach(resetHandlers)`로 격리.
  - `HttpResponse.json(body)`의 `body`는 **`JsonBodyType`**(msw export). `unknown`을 넘기면 타입 에러.
- **DB: testcontainers** — 실제 Postgres를 격리 컨테이너로(integration/E2E). 모킹보다 안전.
- **HTTP E2E: supertest.**

---

## 5. 작성 패턴

- **mock 최소** — 도메인 단위는 mock **0**(응집의 효과). 의존이 단순하면 NestJS `TestingModule` 없이 **`new`로 직접 인스턴스화**(ConfigService 등은 부분 mock 캐스팅). "구현 직접" 결정 덕에 DI 복잡도가 없어 가능.
- **경계값** — 경계 *양쪽*을 찍는다(통과/실패 둘 다: 예 2자/20자 통과, 1자/21자 실패). 버그는 거의 항상 경계에서.
- **`it.each`** — parameterized로 여러 케이스 압축. 케이스 추가가 한 줄.
- **예외는 구체 타입까지** — `expect(...).toThrow(SpecificError)` / 비동기는 `.rejects.toThrow(...)`.
- **정규화 검증** — 어댑터가 provider별 raw를 *공통 형태*로 바꾸는지(예: `VerifiedIdentity`). 어댑터의 본질.
- **테스트 격리** — `afterEach`로 mock/서버 핸들러/상태 리셋.

---

## 6. 용어

- **"도메인 (단위) 테스트"** = 도메인 모델(엔티티·값객체·도메인서비스)의 **mock 0 단위 테스트**. 비표준 용어라 맥락 주의(일부는 "business domain 기능 테스트" 의미로 씀) — 명확히 하려면 *"도메인 단위 테스트"*.
- 어댑터/인프라 테스트(verifier·writer)는 **"도메인 테스트"가 아니다**(도메인 레이어 대상이 아니므로).

---

## 7. E2E 부트스트랩 (testcontainers)

- **스키마 적용**: testcontainers Postgres + `migrate(db, { migrationsFolder })`로 **마이그레이션 파일을 적용**(push 아님 — 운영 경로 검증 + 마이그레이션 파일이 올바른지 같이 검증). drizzle v1.0 마이그레이션은 `폴더/migration.sql + snapshot.json` 구조다.
- **`DRIZZLE` provider override 필수**: 앱·migrate·테스트가 *같은 db 인스턴스*를 공유하도록 `overrideProvider(DRIZZLE).useValue(testDb)`. **env 의존(`process.env.DATABASE_URL`) 금지** — `ConfigModule`이 `.env`를 로드해 앱이 다른 DB로 새어나간다(앱은 로컬, migrate는 컨테이너가 되어 "relation does not exist").
- **외부 어댑터 override**: verifier 등 외부 HTTP는 `overrideProvider(...).useValue(fake)`로 차단(클래스로 둔 덕). 단위는 MSW, E2E는 override.
- **테스트 env는 `test/helpers/test-env.ts`(vitest `setupFiles`)가 세팅** — `setupE2E()` 런타임이 아니다. `ConfigModule.forRoot()`는 AppModule **import 시점**(스펙 파일의 정적 import 체인)에 `.env` 로드+검증 스냅샷을 동기로 끝내고, `ConfigService.get()`은 `process.env`보다 그 스냅샷을 먼저 본다 → `beforeAll`에서 `process.env`를 바꿔도 검증된 키에는 반영되지 않는다(E2E로 발견한 실제 동작 — 그동안 E2E가 로컬 `.env` 값으로 돌고 있었다). setupFiles는 테스트 파일 import 전에 실행되므로 predefined 우선 병합으로 스냅샷에 박히고, E2E가 개발자 `.env`에 의존하지 않는다.
- **상태 격리**: `beforeEach` truncate(자식 테이블 먼저). 컨테이너는 스위트당 1개(케이스마다 X).
- **teardown 순서**: `app.close()` → `pool.end()` → `container.stop()`. pool을 컨테이너보다 **먼저** 정상 종료해야 `57P01 terminating connection` unhandled가 안 난다.
- **barrel 동기화**: `schema/index.ts`(drizzle-kit의 단일 소스)에 모든 스키마가 export돼야 generate·런타임이 인식한다. 빠지면 그 테이블이 마이그레이션·앱 양쪽에서 누락된다.
- **파일 패턴**: vitest 기본 include는 `*.spec.ts`만 → `.e2e-spec.ts`는 `vitest.config.ts`의 `include`에 명시.
