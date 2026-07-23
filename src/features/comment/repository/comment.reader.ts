import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
import { comments, posts, users } from '../../../database/schema';

// 멘션된 유저 join용 별칭 — author(users)와 같은 테이블을 한 쿼리에서 두 번 조인한다.
const mentionedUsers = alias(users, 'mentioned_users');

// 작성자 요약 — inner join(author_id notNull + cascade라 항상 존재, post 전례).
const AUTHOR = { id: users.id, nickname: users.nickname };
// 멘션 요약 — left join 미매칭(멘션 없음·멘션 유저 탈퇴로 set null) 시 객체째 null.
const MENTIONED_USER = { id: mentionedUsers.id, nickname: mentionedUsers.nickname };

// 살아있는 댓글의 content는 앱 불변식상 NOT NULL(NULL ⇔ soft-deleted —
// comment.schema.ts doc)이라, deleted를 배제하는 프로젝션에서만 string으로 좁힌다.
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
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // 단건 조회 — soft-deleted 제외(표적 연산에 소멸한 리소스). null = 비존재·삭제됨.
  async findById(id: string) {
    const [row] = await this.db
      .select(COMMENT_DETAIL_ROW)
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
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
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(
        and(
          eq(comments.postId, params.postId),
          isNull(comments.parentId),
          params.cursor ? gt(comments.id, params.cursor) : undefined,
        ),
      )
      .orderBy(asc(comments.id))
      .limit(params.limit + 1);
  }

  // 페이지의 루트들에 대한 답글 수 — 비정규화 대신 페이지 스코프 집계
  // (idx_comments_parent index-only scan, 페이지당 1쿼리 — posts.commentCount와
  // 달리 전역 스케일 부담이 없어 드리프트 없는 계산을 택한다).
  async replyCounts(rootIds: string[]): Promise<Map<string, number>> {
    if (rootIds.length === 0) return new Map();
    const rows = await this.db
      .select({ parentId: comments.parentId, replyCount: count() })
      .from(comments)
      .where(inArray(comments.parentId, rootIds))
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
      .innerJoin(users, eq(comments.authorId, users.id))
      .leftJoin(mentionedUsers, eq(comments.mentionedUserId, mentionedUsers.id))
      .where(
        and(
          eq(comments.parentId, params.parentId),
          params.cursor ? gt(comments.id, params.cursor) : undefined,
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
