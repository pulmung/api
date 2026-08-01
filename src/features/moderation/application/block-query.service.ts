import { Injectable } from '@nestjs/common';
import { PublicFileUrlResolver } from '../../file/infrastructure/public-file-url.resolver';
import {
  toUserSummaryView,
  type UserSummaryView,
} from '../../user/application/user-summary';
import { UserBlockReader } from '../repository/user-block.reader';

// 차단 목록 읽기 모델 — 응답으로 흐르는 경계 → 명시 타입(§5).
export type BlockedUserItem = {
  // 차단 해제(DELETE /users/:userId/block)의 대상 id이자 이 목록의 커서.
  // inner join이라 non-null — 차단 상대가 탈퇴하면 관계 행도 cascade로 사라진다.
  user: UserSummaryView;
  createdAt: string;
};

export type BlockedUserPage = {
  blocks: BlockedUserItem[];
  nextCursor: string | null;
};

/**
 * 읽기 조합 레이어(CQRS의 쿼리 핸들러 자리) — reader 행을 read model로 빚는다.
 *
 * 조합이 얇지만(자르기 + 커서 파생 + Date 직렬화) reader 직행이 아닌 이유: 이 셋은
 * 표현 변환이고, 컨트롤러에 두면 페이지네이션 규약(limit+1 → hasMore)이 라우트마다
 * 복제된다. CommentQueryService.findReplyPage가 사실상 같은 일만 하는 전례다.
 * (조합이 정말 0인 읽기 — plant 사전 조회 — 는 controller → reader 직행이다, §2.)
 */
@Injectable()
export class BlockQueryService {
  constructor(
    private readonly reader: UserBlockReader,
    private readonly urlResolver: PublicFileUrlResolver,
  ) {}

  async findPage(params: {
    blockerId: string;
    cursor?: string;
    limit: number;
  }): Promise<BlockedUserPage> {
    // reader는 hasMore 판별용 limit+1행까지 준다(n+1) — 끝 감지에 COUNT 불필요.
    const rows = await this.reader.findPageRows(params);
    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;

    return {
      blocks: page.map((row) => ({
        user: toUserSummaryView(row.user, this.urlResolver),
        // z.iso.datetime()은 Date를 거부한다 — 문자열 직렬화는 여기서(post 전례).
        createdAt: row.createdAt.toISOString(),
      })),
      // 커서는 관계 테이블의 정렬 기준인 상대 유저 id다(surrogate id가 없다 — reader doc).
      nextCursor: hasMore ? page[page.length - 1].user.id : null,
    };
  }
}
