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

## 스토리지 / 파일

- [ ] **고아 이미지 청소 — 월간 mark-and-sweep GC** (지금 만들지 않음. 트리거: 스토리지 비용이 눈에 띄거나, private/민감 이미지가 생겨 삭제 지연이 프라이버시로 걸릴 때). ⚠️ 이 항목은 [file-upload.md](file-upload.md) §6의 "고아 파일 정리 → S3 lifecycle (DB 스윕 없음)" 줄을 **대체**한다.
  - **무엇**: 월 1회 배치가 S3 객체 목록 vs DB 참조 key 집합을 대조 → **생성 30일 지난 미참조 객체**만 배치 삭제(`DeleteObjects`). 큐/outbox 아님 — 매 실행이 현재 상태를 통째로 재계산하는 reconciliation이라 재시도 상태머신이 필요 없다(재실행 = 자가치유).
  - **왜 outbox가 아니라 sweep인가**: orphan은 두 종류다 — ① 삭제·이미지교체로 참조 끊긴 key(트리거 있음) ② **presign 받아 업로드 후 submit 안 하고 이탈한 key(트리거 없음 — DB에 들어온 적 없음)**. outbox는 ②를 구조적으로 못 본다. sweep은 "S3에 있는데 DB에서 안 쓰임"으로 ①②를 한 메커니즘으로 잡는다.
  - **왜 지금 안 만들어도 손해 0**: sweep은 과거 기록에 의존하지 않고 실행 시점의 S3·DB를 비교 → 미리 심을 게 없다. **소급 적용**이라 나중에 만들면 그동안 쌓인 orphan(지금부터의 버려진 업로드 포함)을 전부 청소한다. 쓰기 경로(writer·usecase) 무변경.
  - **미리 지켜야 할 3가지(코드 아님, 규율)**: (a) key prefix 규칙 `{purpose}/…` 유지 — GC가 이걸로 객체↔테이블 매핑. (b) 이미지 key를 저장하는 **새 소비처 테이블**(chat 등)이 생기면 참조 스캔 대상에 추가(현재: `user_plants`·`plants`·`posts.image_keys` — posts는 본문 HTML이 아니라 쓰기 시점 파생 컬럼 `image_keys`를 스캔한다, HTML 파싱 불필요). (c) 30일 grace가 "업로드→submit 최대 시간"보다 훨씬 길다는 가정 위에 race-free(현 presign 만료 5분이라 여유 충분).
  - **만들 때 형태**: in-process `@Interval` 금지(인스턴스마다 발화·API 가동에 수명 종속) → 독립 엔트리포인트(`seed/run.ts` 결) + 외부 스케줄러(EventBridge → ECS task/Lambda). 스케일 나면 live `ListObjectsV2` 대신 **S3 Inventory** 매니페스트. IAM에 `s3:DeleteObject` 추가([file-upload.md](file-upload.md) §7).
  - **연계 seam — 계정 삭제**: `user_plants.ownerId`가 `onDelete: cascade`라 계정 삭제는 DB 레벨로 행을 지운다. 그 이미지들도 참조가 끊기므로 결국 이 sweep이 청소한다(별도 enqueue 불필요) — 단 "즉시 파기"가 법적으로 요구되면 그땐 계정 삭제 usecase가 직접 S3 삭제를 호출해야 한다.

## 상시

- [ ] **redact 키 동기화** — 새 자격증명 body 필드가 추가될 때마다 `logger.config.ts`의 `redact`에 키 이름 추가. (PR 체크리스트 후보)
