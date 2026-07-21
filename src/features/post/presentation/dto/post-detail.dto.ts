import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PostListItemSchema } from './post-list-item.schema';

const PostIdParamSchema = z.object({
  id: z.uuid().meta({ description: '게시글 id' }),
});

export class PostIdParamDto extends createZodDto(PostIdParamSchema) {}

// 상세 = 목록 아이템 + 본문·수정시각 — POST 201·PATCH 200(재조회)과 GET :id가 공유.
const PostDetailSchema = PostListItemSchema.extend({
  content: z.string().meta({
    description:
      'sanitize를 통과해 저장된 본문 HTML — img src에 읽기 URL이 포함돼 있어 그대로 렌더 가능',
    example:
      '<p>우리집 <strong>몬스테라</strong> 잎끝이 <span class="color-red">갈색</span>으로 변해요</p>',
  }),
  updatedAt: z.iso.datetime(),
});

export class PostDetailDto extends createZodDto(PostDetailSchema) {}
