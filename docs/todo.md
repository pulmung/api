# TODO — 관측·알림 (미룸: 필요해질 때 additive)

> 구조화 로깅까지는 됨([logging.md](logging.md)). 아래는 **트래픽 · 첫 배포 · 팀**이 실제로 요구할 때 붙인다. 씨앗(단일 에러 길목 · 구조화 JSON · reqId · stdout)이 이미 심겨 있어 각 항목은 대체로 "그날 30분"짜리 additive 작업이다.

> 원칙: **캡처는 넓게, 알림은 집계 신호에 좁게.** 라인 단위 알림 ❌(폭주).

---

## 알림

- [ ] **예외 실시간 알림 (Sentry)** — `@sentry/nestjs` init + 예외 필터 case ③에 `Sentry.captureException(exception)` 한 줄. **기대된 에러(`DomainError`/`HttpException`)는 제외**(로깅 결정과 동일). 그룹핑·중복제거·소스맵이 raw 스택 알림을 대체. → **첫 배포 직전.**
- [ ] **인프라 헬스 알림** — CloudWatch **Metric Filter/Alarm**(집계: "5분간 5xx > N") → SNS → Chatbot/Slack. 라인 스트림 ❌. (과거 CloudWatch→Lambda→Slack을 *라인→집계*로 현대화)

## 메트릭 / 트레이싱

- [ ] **메트릭** (에러율 · p99 지연 · 요청수) — 인터셉터 또는 OTel metrics. 대시보드 + 임계 알림의 소스.
- [ ] **분산 트레이싱 (OpenTelemetry)** — OTel Node SDK 자동계측(HTTP·pg) + pino `mixin`으로 활성 span의 `trace_id`를 로그에 주입(현 `reqId` 옆). logs↔traces 상관. ※ 필드명을 OTel 관례(`trace_id`)에 맞춰 로그 스키마 마이그레이션 회피.

## 비용 / 신뢰성

- [ ] **로그 볼륨 관리** — 샘플링(에러/이상 100%, 성공 샘플) + 보존 티어(hot → cold/archive). **요금이 튀면.**
- [ ] **SLO + 에러버짓 번레이트 알림** — 증상 기반(사용자 영향). "에러 났다"가 아니라 "SLO를 위협하는 속도"에 알림. **온콜/팀이 생기면.**

## 상시

- [ ] **redact 키 동기화** — 새 자격증명 body 필드가 추가될 때마다 `logger.config.ts`의 `redact`에 키 이름 추가. (PR 체크리스트 후보)
