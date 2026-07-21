import { z } from 'zod';

// 목록 아이템 = 상세의 부분집합(상세 = 목록 + content·updatedAt) — 의도된 공유
// (변경 이유 동일: "글을 어떻게 요약 표현하나"). 상세 DTO가 .extend로 파생해
// 두 표현의 구조적 동기화를 보장한다. named component(.meta id)는 안 붙인다 —
// 단독 재사용 단위가 아니라 파생 베이스라 인라인 전개로 충분.
export const PostListItemSchema = z.object({
  id: z.uuid(),
  title: z.string().meta({ example: '몬스테라 잎이 갈변해요' }),
  excerpt: z.string().meta({
    description:
      '본문 플레인텍스트 발췌(최대 200자, 목록 프리뷰용) — 이미지-only 글이면 빈 문자열',
  }),
  thumbnailUrl: z.url().nullable().meta({
    description: '첫 이미지 읽기 URL — 이미지 없는 글이면 null',
    example: 'https://cdn.pulmung.com/post-image/018f2e6a.jpg',
  }),
  author: z.object({
    id: z.uuid(),
    nickname: z.string().meta({ example: '식집사' }),
  }),
  plant: z
    .object({
      id: z.uuid(),
      name: z.string().meta({ example: '몬스테라 알보' }),
    })
    .nullable()
    .meta({ description: '태그된 카탈로그 식물 — 무관한 글이면 null' }),
  createdAt: z.iso.datetime(),
});
