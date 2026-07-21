import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { POST_TITLE_MAX_LENGTH } from '../../domain/post';
import {
  POST_CONTENT_MAX_LENGTH,
  POST_IMAGES_MAX,
  POST_TEXT_COLORS,
} from '../../domain/post-content';

const CreatePostSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(POST_TITLE_MAX_LENGTH)
    .meta({ example: '몬스테라 잎이 갈변해요' }),
  // 세부 규약(허용 태그·src 도메인·알맹이 유무)은 도메인(processPostContent)이 422로
  // 검증한다 — 여기선 형식(문자열·길이)만. 규약은 description으로 codegen에 전달.
  content: z
    .string()
    .min(1)
    .max(POST_CONTENT_MAX_LENGTH)
    .meta({
      description:
        `본문 HTML. 허용 태그: <p> <br> <strong> <s> <span class="color-*"> <img src>. ` +
        `글자색은 닫힌 팔레트 class만(color-${POST_TEXT_COLORS.join(' · color-')}) — inline style은 제거된다. ` +
        `<img src>는 파일 업로드(POST /files, purpose=post-image)로 받은 key의 읽기 URL만 허용. ` +
        `이미지 최대 ${POST_IMAGES_MAX}장. 그 외 태그·속성은 서버 sanitize가 제거하고, ` +
        `위반(외부 이미지·빈 본문 등)은 422로 거부된다.`,
      example:
        '<p>우리집 <strong>몬스테라</strong> 잎끝이 <span class="color-red">갈색</span>으로 변해요</p>',
    }),
  plantId: z.uuid().optional().meta({
    description: '카탈로그(plants) 식물 태그 — 특정 식물에 관한 글이 아니면 생략',
  }),
});

export class CreatePostDto extends createZodDto(CreatePostSchema) {}
