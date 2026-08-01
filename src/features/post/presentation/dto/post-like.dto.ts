import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const PostLikeParamSchema = z.object({
  postId: z.uuid().meta({ description: '게시글 id' }),
});

export class PostLikeParamDto extends createZodDto(PostLikeParamSchema) {}

// PUT·DELETE 공용 응답 — 변경 이유가 같다("좋아요를 누른 뒤 이 글의 좋아요 상태는?").
// 두 라우트가 상태만 반대로 담으므로 분리하면 같은 스키마가 둘로 복제된다(§9).
const PostLikeSchema = z.object({
  isLiked: z.boolean().meta({
    description:
      '요청 후 내 좋아요 상태 — PUT이면 항상 true, DELETE면 항상 false',
  }),
  likeCount: z.int().min(0).meta({
    description:
      '요청 후 이 글의 좋아요 수(권위값) — 멱등 요청(재좋아요·없는 좋아요 취소)이면 불변',
  }),
});

export class PostLikeDto extends createZodDto(PostLikeSchema) {}
