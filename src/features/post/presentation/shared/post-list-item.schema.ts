import { z } from 'zod';
import { UserSummarySchema } from '../../../user/presentation/shared/user-summary.schema';

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
  author: UserSummarySchema,
  plant: z
    .object({
      id: z.uuid(),
      name: z.string().meta({ example: '몬스테라 알보' }),
    })
    .nullable()
    .meta({ description: '태그된 카탈로그 식물 — 무관한 글이면 null' }),
  commentCount: z.int().min(0).meta({
    description:
      '살아있는 댓글 수(루트+답글) — 삭제(soft delete 포함) 즉시 감소',
  }),
  likeCount: z.int().min(0).meta({
    description: '좋아요 수 — 뷰어와 무관한 전역 수치',
  }),
  isLiked: z.boolean().meta({
    description:
      '이 응답을 받는 사람이 좋아요했는지 — 비로그인 열람이면 항상 false. ' +
      '뷰어별 값이라 이 응답은 공유 캐시에 담기지 않는다(Cache-Control: private)',
  }),
  createdAt: z.iso.datetime(),
});
