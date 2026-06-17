import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { createOpenApiDocument } from '../src/openapi';

async function generate() {
  // preview:true → 프로바이더를 인스턴스화하지 않고 라우트/스키마만 스캔한다.
  //  · DB 커넥션·onModuleInit 등 사이드이펙트 없음 (DB 없이 돈다)
  //  · @swc-node/register(SWC)가 decoratorMetadata를 박으므로 @Body() 파라미터
  //    타입이 reflection으로 읽혀 requestBody가 emit된다 (tsx/esbuild로는 불가능)
  //  · 런타임 nest start와 동일한 SWC 컴파일 → /swagger 문서와 일치
  // logger:false → 문서 생성에 로그 노이즈 불필요.
  const app = await NestFactory.create(AppModule, {
    logger: false,
    preview: true,
  });

  const doc = createOpenApiDocument(app);

  // 2-space 들여쓰기 + 끝 개행 → git diff가 깔끔해짐(drift 체크의 신뢰성에 직결).
  writeFileSync('openapi.json', JSON.stringify(doc, null, 2) + '\n');

  await app.close();
  console.log('✅ openapi.json 생성 완료');
}

void generate();
