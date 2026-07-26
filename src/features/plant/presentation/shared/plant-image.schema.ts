import { z } from 'zod';

// 응답 공유 이미지 뷰 — 목록 커버·상세 images·생성 201(조회 표현 재사용)이 공유
// (변경 이유 동일: "저장된 이미지를 어떻게 표현하나"). .meta({ id })로 named component
// 호이스팅 — 반드시 이 단일 인스턴스를 import한다(인스턴스 둘이면 duplicate-id 충돌).
export const PlantImageSchema = z
  .object({
    url: z.url().meta({
      description: '읽기 URL (PUBLIC_FILE_BASE_URL + key 조합)',
      example: 'https://cdn.pulmung.com/plant-image/018f2e6a.jpg',
    }),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .meta({ id: 'PlantImage' });
