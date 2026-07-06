// E2E 테스트 env — vitest setupFiles로 등록되어 **테스트 파일 import 전에** 실행된다.
//
// 왜 setupE2E() 런타임이 아니라 여기인가: ConfigModule.forRoot()는 AppModule이
// import되는 순간(= 스펙 파일의 정적 import 체인) .env 로드 + validate + 스냅샷까지
// 동기로 끝내고, ConfigService.get()은 process.env보다 그 검증 스냅샷을 먼저 본다.
// 즉 beforeAll에서 process.env를 바꿔도 검증된 키에는 반영되지 않는다(늦다).
// 여기서 미리 정의하면 forRoot의 predefined 우선 병합(process.env > .env 파일)으로
// 스냅샷이 이 값들로 찍힌다 → E2E가 개발자 로컬 .env에 의존하지 않는다.
//
// DATABASE_URL은 형식 검증 통과용 플레이스홀더 — 실제 DB는 setupE2E()가
// testcontainer로 띄워 DRIZZLE provider를 override하므로 이 값으로 연결하지 않는다.

export const TEST_FILE_BASE_URL = 'https://cdn.test.example';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.CORS_ORIGINS = 'http://localhost:3001';
process.env.TRUST_PROXY_HOPS = '0';
process.env.GOOGLE_CLIENT_IDS = 'test-google-id';
process.env.KAKAO_APP_ID = '12345';
process.env.JWT_ACCESS_SECRET = 'test-secret';
process.env.REFRESH_TOKEN_TTL_DAYS = '30';
process.env.AWS_REGION = 'ap-northeast-2';
process.env.S3_PUBLIC_FILE_BUCKET = 'test-bucket';
process.env.PUBLIC_FILE_BASE_URL = TEST_FILE_BASE_URL;
