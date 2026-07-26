import { z } from 'zod';
import { COMMENT_CONTENT_MAX_LENGTH } from '../../domain/comment';

// 세 요청 DTO(루트 작성·답글 작성·수정)가 공유하는 본문 필드 — 변경 이유가 같다
// ("댓글 본문의 형식 규약"). 한도는 도메인 상수에서 — 이중기재 drift 방지(post 전례).
export const commentContentField = z
  .string()
  .trim()
  .min(1)
  .max(COMMENT_CONTENT_MAX_LENGTH)
  .meta({
    description: `플레인텍스트 (HTML 아님 — 이스케이프는 렌더 몫). 1–${COMMENT_CONTENT_MAX_LENGTH}자`,
    example: '저희 집 몬스테라도 그랬는데 물 주기를 늘리니 좋아졌어요',
  });
