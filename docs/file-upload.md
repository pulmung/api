# 파일 업로드 (file)

> 이 문서는 [CLAUDE.md](../CLAUDE.md)의 "파일 업로드" 상세본이다.
> **`features/file` 코드, 또는 파일을 첨부받는 소비처 feature(plant·chat 등)를 만지기 전에 읽는다.**

> **한 줄 요약: stateless presign — files 원장 테이블 없이, S3 presigned POST의 policy가 업로드 시점에 크기·타입·키를 강제한다. 파일 메타는 소비처 도메인 테이블 jsonb에 인라인. 버킷은 접근등급별 분리, CloudFront signed URL은 읽기 경로 전용.**

---

## 0. 확정 결정 — 재논의 금지

**files 원장 테이블을 만들지 않는다.** files 테이블 + 2단계(발급→complete) 설계를 검토했다가 **의도적으로 폐기**했다:

- 소유권 강제 → uuidv7 키가 추측 불가라 실익 낮음
- 고아 파일 정리 → S3 lifecycle 규칙으로 대체 가능
- 파일 재사용·쿼터·감사 → 지금 없는 요구

파일이 1급 개념으로 커진다는 확신이 없으므로 단순한 쪽을 택했다.
⚠️ **"성숙한 패턴"을 따르려고 files 테이블·complete 엔드포인트·2단계 흐름을 되살리지 말 것** — 이게 이 feature의 핵심 결정이다. 위 요구(재사용/쿼터/감사)가 실제로 생기면 그때 재검토한다.

---

## 1. 지키는 3가지 (이전 프로젝트 grimity 결함 수정)

grimity의 이미지 업로드는 조건 없는 presigned PUT — 크기·타입 강제 0, 업로드 확인 0. 이 결함만 고쳤다:

| #   | 장치                                                                          | 강제 주체                             |
| --- | ----------------------------------------------------------------------------- | ------------------------------------- |
| 1   | **presigned POST + policy**: `content-length-range` + `Content-Type`·`key` exact-match | S3 (업로드 시점)                       |
| 2   | **불투명 키** `{purpose}/{uuidv7}.{ext}` — ext는 contentType에서 파생. 유저 파일명은 절대 키에 넣지 않는다 | domain (`prepareFileUpload`)          |
| 3   | **첨부 시점 HeadObject 존재 검증** — 존재하지 않는 key 참조 차단               | 소비처 (plant 등) ← `S3FileStorage.head()` seam |

- presigned **PUT이 아니라 POST**인 이유: PUT 서명은 조건을 못 싣는다. POST policy만이 크기 범위·필드 exact-match를 S3가 업로드 시점에 강제하게 한다.
- #3은 이 feature가 아니라 **소비처의 몫** — `FileModule`이 `S3FileStorage`를 export하는 이유("사용 → 소유" 한 방향).

---

## 2. 버킷 전략 — 접근등급(access class)별 분리

**public 파일용 / private 파일용 버킷을 분리한다** (단일 버킷 + `public/`·`private/` prefix 아님). AWS Well-Architected / 빅테크 표준 = 데이터 분류별 버킷:

1. **보안 경계 = 버킷.** BPA·버킷정책·암호화·로깅·lifecycle이 전부 버킷 단위. 섞으면 모든 정책에 prefix 조건이 붙고, 실수 하나 = private 파일 노출(블라스트 반경).
2. **CloudFront 안전.** 단일 버킷 + path behavior는 behavior 순서/default fallback 실수로 private가 public 배포에 노출될 수 있다. 버킷 분리면 public 배포(OAC)가 private 버킷에 물리적으로 접근 불가.
3. **IAM 단순** (prefix-conditioned ARN 제거) + **운영 독립** (private = 개인정보 → 보존/삭제 정책이 다르게 진화). 버킷 자체는 무료.

자주 헷갈리는 것 2가지:

- **"public 버킷"도 S3 레벨에선 private다.** 둘 다 BPA on + CloudFront OAC 뒤. public = CloudFront behavior가 signed URL을 요구하지 않음 / private = signed URL(key group) 요구.
- **CloudFront signed URL은 읽기(다운로드) 경로 전용.** 업로드는 public/private 불문 **S3 presigned POST 직행**이 표준 — CloudFront 경유 업로드는 이득 없이 서명만 복잡해진다.

현재는 `S3_PUBLIC_FILE_BUCKET` 하나만 사용. private은 §5 확장 계획 참조.

---

## 3. 구조 / 흐름

```
src/features/file/
  domain/
    file-purpose.ts    filePurposes(['plant-image']) + FilePurpose
    file-policy.ts     CONTENT_TYPE_EXT(타입→ext, 허용 타입 단일 소스) + FILE_POLICIES(purpose별 타입·크기)
    file.error.ts      UnsupportedFileTypeError(422) · FileTooLargeError(422)
    file-upload.ts     prepareFileUpload() — 검증 + 키 발급 (순수 함수)
  application/         create-file-upload.usecase.ts
  infrastructure/      s3-file.storage.ts — createUploadTarget() + head()
  presentation/        POST /files (@Authenticated) · dto/
  file.module.ts       exports: [S3FileStorage]  ← 소비처의 head() 검증용
```

흐름: `POST /files { purpose, contentType, size? }` → 도메인 검증·키 발급 → presign → `201 { key, upload: { url, fields, expiresAt } }`. **DB에 아무것도 쓰지 않는다** — 클라이언트가 S3에 직접 업로드 후, 소비처 생성 요청(예: 식물 등록)에 key를 실어 보내면 소비처가 `head()`로 실존 확인 후 자기 jsonb에 저장한다. 파일명·치수 등 메타도 그때 소비처 도메인에 들어간다(file feature는 저장 안 함).

설계 포인트 (컨벤션 대비 특이점):

- **`prepareFileUpload`는 엔티티가 아니라 순수 함수** — 보유할 상태·불변식 객체가 없어 정적 팩토리 클래스는 의례(architecture.md §0). "ext는 항상 허용된 contentType에서 파생"이 이 함수 한 곳의 불변식.
- **DTO에 contentType enum을 박지 않는다** — 허용 타입 정책은 domain(`FILE_POLICIES`) 소유. DTO 이중기재 = drift. 그래서 타입 위반은 400(Zod)이 아니라 **422(`UNSUPPORTED_FILE_TYPE`)**.
- **`size`는 optional 힌트** — 알면 조기 422(`FILE_TOO_LARGE`), 최종 강제는 어차피 S3 policy.
- **presign TTL(300초)은 어댑터 소유 상수** — 서명 전송 보안 파라미터이지 도메인 정책이 아님. purpose별 차등이 필요해지면 그때 `FILE_POLICIES`로 이동.
- **env에 AWS 자격증명 키 없음** — default credential chain(prod IAM role / 로컬 profile)에 위임. `AWS_REGION`·`S3_PUBLIC_FILE_BUCKET`만 Zod 스키마에.
- `head()`는 **NotFound만 null, 403 등은 rethrow** — 권한 오류를 "파일 없음"으로 삼키면 디버깅 불가(§7 영속성 원칙과 동일: 모르는 에러는 rethrow).

---

## 4. 테스트 전략 (레벨 분업)

testing.md의 "가장 싸게 신뢰를 주는 레벨" 적용:

| 레벨                                  | 검증하는 것                                                                                    | 비고                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| domain unit (`domain/*.spec.ts`)       | 키 형태·유니크·ext 파생·타입/크기 경계·정책 맵 무결성                                            | mock 0                                                       |
| adapter unit (`s3-file.storage.spec.ts`) | **policy에 조건 3개가 실제로 박히는가** — `fields.Policy` base64 디코드해 확인                   | ⚠️ `createPresignedPost`는 **HTTP 호출 0**(로컬 서명) → MSW 불필요, 진짜 SDK 코드가 그대로 실행됨. 단 env에 fake 자격증명 필요(없으면 IMDS 프로브로 행) |
| adapter unit — `head()`                | 200→`{size}` / 404→null / 403→rethrow                                                          | MSW `http.head()` (여기만 HTTP 모킹)                          |
| E2E (`test/file.e2e-spec.ts`)          | API 계약: 201 형태·401·400(Zod)·422 ×2 (errorCode)                                             | `setup-e2e.ts`가 `S3FileStorage`를 `.overrideProvider`로 fake 교체 — 진짜 S3Client 미생성. 가드·파이프·도메인·직렬화·DB는 전부 진짜 |

남는 구멍 = "진짜 버킷·진짜 IAM으로 업로드되는가"는 코드가 아니라 인프라 구성 문제 → 버킷 프로비저닝 후 수동 스모크 1회.

---

## 5. private 파일 확장 계획 (chat feature 때 — 지금 만들지 않는다)

- **업로드는 `S3FileStorage` 확장이지 새 클래스가 아니다** — presign·head 로직은 동일, 버킷만 다름:
  - `bucket: string` 필드 → `buckets: Record<FileAccess, string>` 맵 (`FileAccess = 'public' | 'private'`)
  - `FILE_POLICIES`에 `access` 필드 추가 — **어느 버킷인지는 호출자가 아니라 purpose(도메인 정책)가 결정**
  - `createUploadTarget`/`head`가 `access` 파라미터를 받아 `buckets[access]`로 선택
  - env `S3_PRIVATE_FILE_BUCKET` 추가
  - ※ 같은 클래스를 버킷별 인스턴스 2개로 DI 등록하는 방식은 비추 — Symbol 토큰·custom provider 의례가 생기는데 얻는 건 한 줄 맵 조회 대체뿐("구현 직접 = 클래스가 곧 DI 토큰" 컨벤션 파괴).
- **읽기(다운로드)는 별도 어댑터** — CloudFront signed URL 발급은 다른 외부 시스템(`@aws-sdk/cloudfront-signer`, key pair env, `ResponseContentDisposition`)이라 변경 이유가 다르다. `S3FileStorage`에 넣지 말 것.

## 6. 그 외 seam / 연기 목록

| seam                            | 언제/어디서                                                                 |
| ------------------------------- | --------------------------------------------------------------------------- |
| 첨부 시점 `head()` 검증 + images jsonb | plant feature — `plants.images`는 단일 jsonb(배열 of `{key, width?, ...}`) 권장 |
| 이미지 치수                      | 클라 제공값 = 신뢰 불가 힌트(피드 CLS 방지용으론 충분). 진짜 치수는 추후 S3 이벤트→Lambda |
| 고아 파일 정리                   | S3 lifecycle 규칙 (원장 테이블이 없으니 DB 스윕 없음)                          |
| 원본 파일명 복원(채팅 다운로드)   | 메타를 message jsonb에 + presigned GET `ResponseContentDisposition`            |
| `FILE_BASE_URL` (읽기 URL 조합)  | 첫 읽기 경로(plant 조회)에서 도입                                              |

## 7. 인프라 요구 (코드 밖 — 배포 전 체크)

- IAM: `s3:PutObject` + `s3:GetObject` + **`s3:ListBucket`** — 마지막이 없으면 미존재 키 HeadObject가 404가 아니라 **403**으로 와서 `head()`가 null 대신 throw한다.
- 버킷 CORS에 웹 오리진의 POST 허용.
- Block Public Access 유지 (읽기는 CloudFront OAC로).
