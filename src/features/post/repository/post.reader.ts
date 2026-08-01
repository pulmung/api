import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { DrizzleDB } from '../../../database/drizzle.constants';
import type { DrizzleTransactionalAdapter } from '../../../database/drizzle-transactional.adapter';
import { plants, postLikes, posts, users } from '../../../database/schema';
import { excludeBlocked } from '../../moderation/repository/block-filter';
import { userSummaryColumns } from '../../user/repository/user-summary.columns';

// 게시글 read model의 원천 행 — 부분 select(옵트인). content는 상세 전용이라 목록 제외
// (본문 50k까지 가능 — 목록에 실으면 페이로드가 터진다). authorId 원시 컬럼 대신
// 작성자 요약을 join으로 — 게시판은 공개 자원이라 응답에 작성자 표시가 필수다.
const POST_LIST_ROW = {
  id: posts.id,
  title: posts.title,
  excerpt: posts.excerpt,
  thumbnailKey: posts.thumbnailKey,
  // 비정규화 카운터(증감은 comment.writer 몫) — 목록 표시가 조회 0비용인 이유.
  commentCount: posts.commentCount,
  // 같은 결(증감은 post-like.writer 몫). "내가 눌렀는지"는 뷰어별이라 별도 조회다(아래).
  likeCount: posts.likeCount,
  createdAt: posts.createdAt,
  // 작성자 요약 — inner join(author_id notNull + onDelete cascade라 항상 존재).
  // 탈퇴하면 글 자체가 사라지므로 "작성자 없는 글"이 존재하지 않는다 — 댓글과 갈리는
  // 지점이다(comment.reader의 AUTHOR는 left join). 근거는 post.table.ts authorId doc.
  // projection 조각은 user 소유 — 아바타 key가 여기 실려 오고 URL 조합은 query service 몫.
  author: userSummaryColumns(users),
  // 식물 태그 요약 — left join 미매칭 시 drizzle이 객체째 null로 접는다(user-plant 전례).
  plant: { id: plants.id, name: plants.name },
};

const POST_DETAIL_ROW = {
  ...POST_LIST_ROW,
  content: posts.content,
  updatedAt: posts.updatedAt,
};

// 읽기 어댑터 — 순수 DB 접근. users/plants 직접 join은 모듈 경계 위반이 아니라
// CQRS 읽기의 정상 경로다(read model은 테이블을 횡단한다 — user-plant reader 전례).
@Injectable()
export class PostReader {
  constructor(
    private readonly txHost: TransactionHost<DrizzleTransactionalAdapter>,
  ) {}

  // 진행 중인 트랜잭션이 있으면 그 핸들을, 없으면 평범한 db를 준다(CLS가 고른다) —
  // 덕분에 이 어댑터의 쿼리는 트랜잭션 안팎에서 같은 코드로 동작한다.
  private get db(): DrizzleDB {
    return this.txHost.tx;
  }

  // 공개 읽기 — 소유 스코프 없음(게시판). null = 진짜 비존재뿐.
  async findById(id: string) {
    const [row] = await this.db
      .select(POST_DETAIL_ROW)
      .from(posts)
      .innerJoin(users, eq(posts.authorId, users.id))
      .leftJoin(plants, eq(posts.plantId, plants.id))
      .where(eq(posts.id, id));
    return row ?? null;
  }

  // keyset 페이지네이션(uuidv7 id DESC = 최신순) — 전역 목록은 PK btree가,
  // authorId/plantId 필터는 (fk, id) 복합 인덱스가 정렬까지 커버한다.
  // ⚠️ hasMore 판별용으로 limit+1개까지 반환한다(n+1) — 자르기·nextCursor는 호출자 몫.
  // 차단 필터가 WHERE에 있으므로 이 limit+1은 **필터 통과 행 기준**이다 — 앱에서 후처리로
  // 걸러내면 페이지가 들쭉날쭉해지지만(20 요청 → 17개) SQL이면 DB가 채워서 준다.
  async findPageRows(params: {
    cursor?: string;
    limit: number;
    plantId?: string;
    authorId?: string;
    viewerId?: string;
  }) {
    return this.db
      .select(POST_LIST_ROW)
      .from(posts)
      .innerJoin(users, eq(posts.authorId, users.id))
      .leftJoin(plants, eq(posts.plantId, plants.id))
      .where(
        and(
          params.authorId ? eq(posts.authorId, params.authorId) : undefined,
          params.plantId ? eq(posts.plantId, params.plantId) : undefined,
          params.cursor ? lt(posts.id, params.cursor) : undefined,
          // 서로 차단한 관계의 글 제외(양방향). 익명 뷰어면 undefined라 조건이 빠진다.
          // ⚠️ 상세(findById)에는 붙이지 않는다 — 차단은 목록 필터일 뿐이라는 결정
          // (user-block.table.ts doc "효과 범위").
          excludeBlocked(this.db, params.viewerId, posts.authorId),
        ),
      )
      .orderBy(desc(posts.id))
      .limit(params.limit + 1);
  }

  /**
   * 좋아요 수 단건 조회 — 멱등 경로(이미 좋아요/좋아요 없음)에서 카운터를 건드리지 않고
   * 현재 값만 응답에 싣기 위한 것. null = 비존재 글(호출자가 404로 번역).
   */
  async findLikeCount(postId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ likeCount: posts.likeCount })
      .from(posts)
      .where(eq(posts.id, postId));
    return row?.likeCount ?? null;
  }

  /**
   * 이 뷰어가 좋아요한 글 id들 — 페이지 스코프 배치 조회(CommentReader.replyCounts 전례).
   * idx_post_likes_user(user_id, post_id)가 index-only로 커버한다.
   *
   * 왜 본 쿼리에 LEFT JOIN 하지 않나: 뷰어가 없을 때(익명)와 있을 때로 조인·프로젝션이
   * 갈려 쿼리 빌더가 두 갈래가 된다. 목록당 왕복 1회가 그 복잡도보다 싸다 —
   * 페이지 크기가 최대 50이라 조회 자체는 인덱스 한 번이다.
   */
  async likedPostIds(userId: string, postIds: string[]): Promise<Set<string>> {
    // inArray는 빈 배열에서 유효한 SQL을 못 만든다 — 호출 전에 거른다(replyCounts 전례).
    if (postIds.length === 0) return new Set();

    const rows = await this.db
      .select({ postId: postLikes.postId })
      .from(postLikes)
      .where(
        and(eq(postLikes.userId, userId), inArray(postLikes.postId, postIds)),
      );
    return new Set(rows.map((row) => row.postId));
  }
}
