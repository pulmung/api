import { z } from 'zod';
import { plantCategories } from '../../domain/plant-category';

// OpenAPI 공유 컴포넌트 — .meta({ id })가 zod globalRegistry에 등록되고,
// cleanupOpenApiDoc이 components.schemas로 호이스팅해 사용처를 $ref로 바꾼다.
// 반드시 이 단일 인스턴스를 모든 DTO가 import한다(.meta({ id }) 인스턴스가
// 둘이면 duplicate-id 충돌). 값 배열의 단일 소스는 여전히 domain.
// ⚠️ zod ≥4.4가 $defs body의 id를 벗기면서 nestjs-zod 5.4는 input 쪽 컴포넌트를
// `CreatePlantDtoPlantCategory`로 리네임한다(output은 `PlantCategory_Output` 유지).
// nestjs-zod가 zod 4.4에 적응하면 openapi:generate 재실행 diff로 `PlantCategory`로 돌아온다.
export const PlantCategorySchema = z.enum(plantCategories).meta({
  id: 'PlantCategory',
});
