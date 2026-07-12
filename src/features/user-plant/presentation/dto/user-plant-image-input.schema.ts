import { z } from 'zod';

// 이미지 아이템의 요청 형태 — create/update DTO가 공유한다(단일 소스).
// 응답 쪽 PlantImageSchema(url 기반)와 다른 계약이라 별도 스키마다.
// key는 POST /files(purpose: user-plant-image)로 발급받은 값.
// prefix 등 형식 위반은 400(Zod)이 아니라 422(도메인)로 갈라진다 — 규칙은 도메인 소유.
export const UserPlantImageInputSchema = z.object({
  key: z.string().min(1).meta({
    example: 'user-plant-image/0198c5b2-2f74-7abc-8def-0123456789ab.jpg',
  }),
  // 클라 제공 힌트(피드 CLS 방지용) — 서버는 실존(head)만 검증한다.
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
