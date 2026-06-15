import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { createOpenApiDocument } from '../src/openapi';

async function generate() {
  // preview:true → 프로바이더를 인스턴스화하지 않고 라우트/스키마만 스캔한다.
  //  · DB 커넥션·onModuleInit 등 사이드이펙트 없음 (DB 없이 돈다)
  //  · tsx(esbuild)의 emitDecoratorMetadata 한계도 비켜감
  //  · 런타임 /swagger 문서와 바이트까지 동일함을 확인함 → drift 체크가 신뢰 가능
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
