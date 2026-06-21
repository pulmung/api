import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

export function createOpenApiDocument(app: INestApplication) {
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('pulmung API')
      .setVersion('1.0')
      .setOpenAPIVersion('3.1.0')
      .build(),
  );

  return cleanupOpenApiDoc(doc);
}
