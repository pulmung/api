import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { DrizzleDB } from '../../../database/drizzle.constants';
import type { DrizzleTransactionalAdapter } from '../../../database/drizzle-transactional.adapter';
import { comments, posts, users } from '../../../database/schema';
import { excludeBlocked } from '../../moderation/repository/block-filter';
import { userSummaryColumns } from '../../user/repository/user-summary.columns';

// 멘션된 유저 join용 별칭 — author(users)와 같은 테이블을 한 쿼리에서 두 번 조인한다.
const mentionedUsers = alias(users, 'mentioned_users');

// 작성자 요약 — **left join**이다(author_id nullable + set null: 탈퇴해도 댓글은 남고
// 작성자만 사라진다 — comment.table.ts). 미매칭 시 객체째 null(아래 멘션과 같은 결).
// ⚠️ inner join으로 되돌리면 탈퇴 유저의 댓글이 목록에서 조용히 사라져 스레드에 구멍이
// 뚫린다(replyCount는 users를 안 보므로 개수 불일치까지 생긴다). 방어선은 E2E뿐 — post 전례.
// projection 조각은 user 소유 — 별칭 테이블도 받으므로 아래 멘션과 같은 조각을 쓴다.
const AUTHOR = userSummaryColumns(users);
// 멘션 요약 — left join 미매칭(멘션 없음·멘션 유저 탈퇴로 set null) 시 객체째 null.
const MENTIONED_USER = userSummaryColumns(mentionedUsers);

// 살아있는 댓글의 content는 앱 불변식상 NOT NULL(NULL ⇔ soft-deleted —
// comment.table.ts doc)이라, deleted를 배제하는 프로젝션에서만 string으로 좁힌다.
const LIVE_CONTENT = sql<string>`${comments.content}`;

// 단건 표현(POST 201·PATCH 200 재조회) — 답글 목록과 달리 parentId 포함
// (URL 컨텍스트가 없어 루트/답글 구분을 응답이 스스로 말해야 한다).
const COMMENT_DETAIL_ROW = {
  id: comments.id,
  parentId: comments.parentId,
  content: LIVE_CONTENT,
  createdAt: comments.createdAt,
  updatedAt: comments.updatedAt,
  author: AUTHOR,
  mentionedUser: MENTIONED_USER,
};

// 읽기 어댑터 — 순수 DB 접근. users/posts 직접 join·조회는 모듈 경계 위반이 아니라
// CQRS 읽기의 정상 경로다(post reader 전례).
@Injectable()
export class CommentReader {
  constructor(
    private readonly txHost: TransactionHost<DrizzleTransactionalAdapter>,
  ) {}

  // 진행 중인 트랜잭션이 있으면 그 핸들을, 없으면 평범한 db를 준다(CLS가 고른다) —
  // 덕분에 이 어댑터의 쿼리는 트랜잭션 안팎에서 같은 코드로 동작한다.
  private get db(): DrizzleDB {
    return this.txHost.tx;
  }

  // 단건 조회 — soft-deleted 제외(표적 연산에 소멸한 리소스). null = 비존재·삭제됨.
  async findById(id: string) {
    const [row] = await this.db
      .select(COMMENT_DETAIL_ROW)
      .from(comments)
      .leftJoin(users, eq(comments.authorId, users.id))
      .leftJoin(mentionedUsers, eq(comments.mentionedUserId, mentionedUsers.id))
      .where(and(eq(comments.id, id), isNull(comments.deletedAt)));
    return row ?? null;
  }

  // 루트 목록 — 오래된 순(id ASC = 등록순, 댓글 관례라 post 목록의 DESC와 반대).
  // soft-deleted도 행으로 나온다(플레이스홀더) — deleted 분기는 query service 몫.
  // idx_comments_post (post_id, parent_id, id)가 IS NULL 등호까지 포함해 정렬을 커버.
  // ⚠️ hasMore 판별용으로 limit+1개까지 반환한다(n+1) — 자르기·nextCursor는 호출자 몫.
  async findRootPageRows(params: {
    postId: string;
    cursor?: string;
    limit: number;
    viewerId?: string;
  }) {
    return this.db
      .select({
        id: comments.id,
        // 플레이스홀더가 섞이므로 nullable 그대로 — deletedAt과 함께 판독한다.
        content: comments.content,
        deletedAt: comments.deletedAt,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
        author: AUTHOR,
      })
      .from(comments)
      .leftJoin(users, eq(comments.authorId, users.id))
      .where(
        and(
          eq(comments.postId, params.postId),
          isNull(comments.parentId),
          params.cursor ? gt(comments.id, params.cursor) : undefined,
          // 서로 차단한 관계의 댓글 제외(양방향). 익명 뷰어면 조건이 빠진다.
          // ⚠️ 차단된 유저의 루트가 빠지면 그 밑의 (차단 안 한 사람의) 답글도 함께
          // 접근 불가가 된다 — 답글은 루트를 앵커로만 조회되므로. 스레드 통째로 숨기는
          // 것이 주요 SNS의 동작이기도 해서 수용한다.
          excludeBlocked(this.db, params.viewerId, comments.authorId),
        ),
      )
      .orderBy(asc(comments.id))
      .limit(params.limit + 1);
  }

  // 페이지의 루트들에 대한 답글 수 — 비정규화 대신 페이지 스코프 집계
  // (idx_comments_parent index-only scan, 페이지당 1쿼리 — posts.commentCount와
  // 달리 전역 스케일 부담이 없어 드리프트 없는 계산을 택한다).
  //
  // 차단 필터를 **여기엔 적용한다** — posts.commentCount와의 의도적 비대칭이다.
  // ① 이건 실시간 집계라 조건 추가가 공짜인데 commentCount는 비정규화 컬럼이라 뷰어별
  //    필터가 애초에 불가능하다. ② 불일치가 드러나는 방식이 다르다: "답글 2개" 버튼을
  //    눌러 1개가 나오면 **같은 화면 안에서** 즉시 보이지만, commentCount 불일치는
  //    목록↔상세 간이라 덜 드러난다(그쪽은 드리프트를 수용하기로 한 결정).
  // ⚠️ index-only scan은 여기서 깨진다(차단 서브쿼리가 users_blocks를 추가로 탄다) —
  //    페이지당 1쿼리라 수용. 문제가 되면 그때 카운트를 비정규화 컬럼으로 옮긴다.
  // 이 쿼리는 users를 조인하지 않는다 — 답글 목록이 left join이므로 두 쿼리의 대상 집합이
  // 일치한다. (답글 목록이 inner join으로 되돌아가면 여기만 탈퇴 유저 답글을 계속 세서
  // "답글 N개"와 실제 개수가 어긋난다 — 위 ②가 말한 같은 화면 안의 불일치가 된다.)
  async replyCounts(
    rootIds: string[],
    viewerId?: string,
  ): Promise<Map<string, number>> {
    if (rootIds.length === 0) return new Map();
    const rows = await this.db
      .select({ parentId: comments.parentId, replyCount: count() })
      .from(comments)
      .where(
        and(
          inArray(comments.parentId, rootIds),
          excludeBlocked(this.db, viewerId, comments.authorId),
        ),
      )
      .groupBy(comments.parentId);

    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.parentId) counts.set(row.parentId, row.replyCount);
    }
    return counts;
  }

  // 답글 목록 — 루트와 같은 등록순(id ASC). 답글은 soft delete가 없어(writer 삼분기)
  // deleted 분기 불요. idx_comments_parent (parent_id, id)가 정렬까지 커버.
  // ⚠️ limit+1 반환 — 자르기·nextCursor는 호출자 몫.
  async findReplyPageRows(params: {
    parentId: string;
    cursor?: string;
    limit: number;
    viewerId?: string;
  }) {
    return this.db
      .select({
        id: comments.id,
        content: LIVE_CONTENT,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
        author: AUTHOR,
        mentionedUser: MENTIONED_USER,
      })
      .from(comments)
      .leftJoin(users, eq(comments.authorId, users.id))
      .leftJoin(mentionedUsers, eq(comments.mentionedUserId, mentionedUsers.id))
      .where(
        and(
          eq(comments.parentId, params.parentId),
          params.cursor ? gt(comments.id, params.cursor) : undefined,
          // 답글도 같은 필터를 받는다 — 루트가 안 보여도 답글 URL을 직접 알면 열 수 있으니
          // (replyCount와 목록이 어긋나지 않으려면 두 쿼리가 같은 조건을 써야 한다).
          excludeBlocked(this.db, params.viewerId, comments.authorId),
        ),
      )
      .orderBy(asc(comments.id))
      .limit(params.limit + 1);
  }

  // 답글 생성의 부모 사전 분류용 — 존재·루트 여부·삭제 여부를 한 행으로.
  // (2계층 불변식·"삭제된 댓글에 답글 금지"는 유니크/FK가 못 주는 진실이라
  // 사전 SELECT가 불가피한 경우다 — user-plant exists §7 예외와 같은 결.)
  async findParentMeta(id: string) {
    const [row] = await this.db
      .select({
        postId: comments.postId,
        parentId: comments.parentId,
        deletedAt: comments.deletedAt,
      })
      .from(comments)
      .where(eq(comments.id, id));
    return row ?? null;
  }

  // 루트 목록 빈 페이지의 "빈 글 vs 비존재 글" 판별용 (watering 전례).
  async postExists(postId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    return rows.length > 0;
  }

  // 답글 목록 빈 페이지의 판별용 — 루트만 유효한 스레드 앵커다(답글 id면 404).
  // soft-deleted 루트도 true: 플레이스홀더의 답글 열람은 스레드 보존의 목적 그 자체.
  async rootExists(id: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.id, id), isNull(comments.parentId)))
      .limit(1);
    return rows.length > 0;
  }
}
