# 환경변수 / 설정 (config)

> 이 문서는 [CLAUDE.md](../CLAUDE.md)의 "환경변수 / 설정" 컨벤션 상세본이다.
> **env 관련 코드(검증 스키마, `ConfigService` 소비, `.env.sample`)를 만지기 전에 반드시 이 파일을 읽는다.**

> **한 줄 요약: 환경변수는 신뢰 불가 외부 입력 — 부팅 시 Zod로 검증해 통과 못 하면 서버를 띄우지 않는다(fail-fast). 스키마가 단일 소스, 타입은 `z.infer`로 파생.**

- **검증 도구는 Zod**(`joi`/`class-validator` ❌). 스키마 → 타입 자동 추론(`z.infer`)이 Drizzle `$inferSelect` 철학과 동일하고, 2026 기준 생태계 표준 + Standard Schema 호환(락인 없음).
- **스키마 위치**: `src/config/env.validation.ts`. `z.object`로 정의하고 `export type Env = z.infer<typeof envSchema>`로 타입을 파생한다 — **손으로 타입을 적지 않는다**.
- **`@nestjs/config`의 `validate` 훅에 연결**한다(`ConfigModule.forRoot({ validate: validateEnv })`). 검증 실패 시 `safeParse` + `z.prettifyError`로 읽기 좋은 메시지를 던져 **모듈 로드 단계에서 부팅을 중단**(서버가 `listen`까지 못 감).
- **env는 항상 문자열** → 숫자/불리언은 `z.coerce`로 변환(`z.coerce.number()`). 없을 수 있는 값은 `.default(...)`로 채운다(방어 코드 `?? 기본값`을 코드에서 걷어낼 수 있음).
- **Zod 4 문법**: 포맷 검증은 top-level(`z.url()`, `z.email()` …). 옛 `z.string().url()`은 deprecated.
- **소비는 타입 안전하게**: `ConfigService<Env, true>` + `get('KEY', { infer: true })`. 둘째 제네릭 `true`(=검증됨)로 반환 타입이 `| undefined` 없이 추론된다. 수동 제네릭(`get<string>(...)`)으로 타입을 우기지 않는다.
- **정적 타입 ↔ 런타임 검증은 보완 관계**: TS는 코드 타입만(빌드 타임), Zod는 실제 값을(런타임) 검사한다. 외부 입력인 env는 반드시 런타임 검증이 필요하다.
- **`.env.sample`은 스키마와 1:1 동기화**한다 — 스키마에 키를 추가하면 sample에도 문서화(필수/선택·허용값 주석).
- ⚠️ **global 모듈과 DI는 별개**: `isGlobal: true`는 **모듈 import 생략**만 면제한다. provider에서 `ConfigService`를 쓰려면 여전히 **`inject`는 명시**해야 한다.
