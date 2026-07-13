import { z } from 'zod';
import { socialProviders } from '../../domain/social-provider';

// OpenAPI 공유 컴포넌트 — .meta({ id })가 zod globalRegistry에 등록되고,
// cleanupOpenApiDoc이 components.schemas로 호이스팅해 사용처를 $ref로 바꾼다.
// 반드시 이 단일 인스턴스를 모든 DTO가 import한다(.meta({ id }) 인스턴스가
// 둘이면 duplicate-id 충돌). 값 배열의 단일 소스는 여전히 domain.
export const SocialProviderSchema = z.enum(socialProviders).meta({
  id: 'SocialProvider',
});
