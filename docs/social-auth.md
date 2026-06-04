# 소셜 로그인 / 회원가입 (social auth)

> 카카오 · 구글 소셜 가입·로그인 구현 노트. `auth` feature 작업 전 읽는다.

> **결정: ② access_token 방식으로 통일한다 (카카오 · 구글). 애플은 현재 배제(미정).**

> **원칙: 클라가 보낸 신원(email/id)을 믿지 않는다. provider가 발급한 access_token을 provider에 되물어 신원을 재도출하고, "우리 앱이 발급한 토큰인지(출처)"를 검증한 뒤, 우리 자체 JWT를 발급한다.**

---

## 방식 종류 (참고)

| 방식                 | 백엔드가 받는 것 | 검증 방법                                      | 채택 |
| -------------------- | ---------------- | ---------------------------------------------- | ---- |
| ① Authorization Code | code             | client_secret로 서버 교환                      | ❌   |
| **② Access Token**   | access_token     | provider introspection + 출처(aud/app_id) 비교 | ✅   |
| ③ ID Token (OIDC)    | id_token(JWT)    | JWKS 서명검증 (오프라인)                       | ❌   |

② 선택 이유: 카카오 네이티브 SDK가 access_token을 바로 주고, 단일 모델로 카카오·구글을 처리.
트레이드오프: 로그인마다 provider 호출 1~2회(캐시 불가).

---

## 공통 흐름

```
1. 클라가 provider access_token 획득 → 백엔드로 전송 (받는 즉시)
2. 출처 검증 — 이 토큰이 "우리 앱"이 발급한 게 맞는지 (필수, 먼저)
3. 신원 조회 — sub/id, email
4. 가입/로그인 → 우리 자체 JWT(access+refresh) 발급
```

> ⚠️ **출처 검증을 빼면 안 된다.** userinfo류(`user/me`, `userinfo`)는 _유효한 토큰이면 어느 앱 거든_ 통과시킨다 → 공격자가 자기 앱 토큰으로 임의 계정에 로그인 가능. 출처 검증은 introspection 엔드포인트(`access_token_info` / `tokeninfo`)에서만 된다.

---

## 구글

클라(웹 GIS / 앱 SDK)가 access_token(`ya29.…`) 획득 → 백엔드 전송.
`ya29.` 토큰은 불투명 문자열 → **decode 불가**. 신원은 반드시 tokeninfo로 조회.

**`tokeninfo` 1콜로 출처 + 신원 동시 처리:**

```
GET https://oauth2.googleapis.com/tokeninfo?access_token=<ACCESS_TOKEN>
```

```json
{
  "aud": "<client_id>.apps.googleusercontent.com",
  "azp": "<client_id>.apps.googleusercontent.com",
  "sub": "108914964521372126555",
  "email": "user@gmail.com",
  "email_verified": "true",
  "exp": "1780302894"
}
```

검증 순서:

1. **출처**: `aud`(또는 `azp`) ∈ 우리 OAuth **Client ID 집합** → 불일치 시 401
2. `exp` 만료 확인
3. `sub`(구글 고유 ID) + `email`로 가입/로그인

> - 비교 대상은 GCP "프로젝트 ID"가 아니라 **OAuth Client ID 전체 문자열**(`xxx.apps.googleusercontent.com`). 웹/Android/iOS를 따로 등록하면 client_id가 여러 개 → **집합(set) 검사**.
> - tokeninfo는 구글 공식적으로 **디버그용 + rate limit** 경로다. 트래픽 증가 시 throttle 위험 → 모니터링 필요.

---

## 카카오

클라(앱 네이티브 SDK)가 access_token 획득 → 백엔드 전송.
`access_token_info`가 `app_id`만 주고 email은 안 주므로 **2콜** 필요.

**① 출처 검증 — `access_token_info`:**

```
GET https://kapi.kakao.com/v1/user/access_token_info
Authorization: Bearer <ACCESS_TOKEN>
```

```json
{ "id": 4728944876, "app_id": 1347156, "expires_in": 21467 }
```

→ `app_id` === 우리 카카오 앱 id → 불일치 시 401

**② 신원 조회 — `user/me`:**

```
GET https://kapi.kakao.com/v2/user/me
Authorization: Bearer <ACCESS_TOKEN>
```

```json
{
  "id": 4728944876,
  "kakao_account": { "email": "user@kakao.com", "is_email_verified": true }
}
```

→ `id`(회원번호) + email로 가입/로그인

> 식별 키는 `id`(회원번호). 카카오는 한 앱에 Android/iOS/Web 플랫폼을 묶으므로 `app_id`는 **단일 비교**.

---

## 백엔드 설계

엔드포인트:

```
POST /auth/social (예시)
{ "provider": "google" | "kakao", "accessToken": "..." }
```

provider별 verifier:

```
google: tokeninfo  → aud ∈ clientIds 검증           → { sub, email }
kakao : access_token_info → app_id === appId 검증
        user/me            →                          { id, email }
→ (provider, providerUserId)로 users 조회 or 생성 → 자체 JWT 발급
```

검증값 요약:

| provider | 출처 검증 필드 | 비교 대상(env)            | 신원 키 |
| -------- | -------------- | ------------------------- | ------- |
| google   | `aud` / `azp`  | `GOOGLE_CLIENT_IDS`(집합) | `sub`   |
| kakao    | `app_id`       | `KAKAO_APP_ID`            | `id`    |

---

## 공통 주의

- access_token은 **단수명 증거** — 클라가 쥐고 있지 말고 발급 직후 전송. `exp` 지나면 검증 실패.
- 출처 검증 실패 = **즉시 401**. 신원 조회보다 먼저.
- 검증된 `(provider, providerUserId)`를 users 테이블 소셜 컬럼에 매핑.
- 소셜 토큰은 handshake용 — 우리 세션 토큰으로 끌고 다니지 않는다.
- OAuth 키는 플랫폼별 분리 등록(웹/Android/iOS). 구글은 그래서 client_id가 복수.

---

## 미정 / 배제

- **애플**: 현재 배제. 도입 시 주의 — 애플은 introspection 엔드포인트가 없어 **②로 불가**하며, id_token(JWKS) 서명검증(③)이 강제된다. 도입 결정 시 별도 설계 필요.
