import { Injectable } from '@nestjs/common';
import { DatabaseError } from 'pg';
import { and, DrizzleQueryError, eq, inArray, sql } from 'drizzle-orm';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { DrizzleDB } from '../../../database/drizzle.constants';
import type { DrizzleTransactionalAdapter } from '../../../database/drizzle-transactional.adapter';
import { PG_ERROR_CODE } from '../../../database/postgres-error';
import {
  posts,
  FK_POSTS_AUTHOR,
  FK_POSTS_PLANT,
  type NewPost,
} from '../../../database/schema';
import { UnauthenticatedError } from '../../auth/domain/auth.error';
import { Post, PostPatch } from '../domain/post';
import { ReferencedPlantNotFoundError } from '../domain/post.error';

@Injectable()
export class PostWriter {
  constructor(
    private readonly txHost: TransactionHost<DrizzleTransactionalAdapter>,
  ) {}

  // 진행 중인 트랜잭션이 있으면 그 핸들을, 없으면 평범한 db를 준다(CLS가 고른다) —
  // 덕분에 이 어댑터의 쿼리는 트랜잭션 안팎에서 같은 코드로 동작한다.
  private get db(): DrizzleDB {
    return this.txHost.tx;
  }

  // 응답은 컨트롤러가 재조회(PostQueryService)로 만든다 — writer는 영속화만.
  async create(post: Post): Promise<void> {
    try {
      await this.db.insert(posts).values({
        id: post.id,
        authorId: post.authorId,
        plantId: post.plantId,
        title: post.title,
        // 파생(excerpt·thumbnailKey·imageKeys)이 본문과 함께 있음은 Post 팩토리가 보장
        // (processPostContent 묶음만 받음) — writer는 평평한 필드를 그대로 영속화한다.
        content: post.content,
        excerpt: post.excerpt,
        thumbnailKey: post.thumbnailKey,
        imageKeys: post.imageKeys,
      });
    } catch (e) {
      this.throwIfFkViolation(e);
      throw e;
    }
  }

  /**
   * @returns false = 비존재 또는 타인 글 (구분하지 않는다 — 존재 은닉)
   *
   * ⚠️ 작성자가 탈퇴한 글(author_id IS NULL)은 **아무도 수정할 수 없다** — 아래 술어의
   *    `NULL = 'uuid'`가 NULL이라 어떤 요청자로도 매칭되지 않는다. 의도된 귀결이며
   *    근거·운영 경로는 post.table.ts의 authorId doc 참조.
   */
  async update(
    id: string,
    authorId: string,
    patch: PostPatch,
  ): Promise<boolean> {
    // undefined 필드는 SET에서 제외 = 컬럼을 건드리지 않는다(merge-patch).
    // content가 패치되면 파생 3필드도 반드시 함께 정의돼 있다(PostPatch 팩토리가
    // ProcessedPostContent 묶음만 받음) — 개별 매핑해도 흩어질 경로가 없다.
    const set: Partial<NewPost> = {};
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.content !== undefined) set.content = patch.content;
    if (patch.excerpt !== undefined) set.excerpt = patch.excerpt;
    if (patch.thumbnailKey !== undefined) set.thumbnailKey = patch.thumbnailKey;
    if (patch.imageKeys !== undefined) set.imageKeys = patch.imageKeys;
    if (patch.plantId !== undefined) set.plantId = patch.plantId;
    // updatedAt은 스키마 $onUpdate가 UPDATE마다 자동으로 SET에 붙는다 — 명시 불필요.

    try {
      // 작성자 스코프를 WHERE에 — race-safe 1쿼리. RETURNING id로 0행(=404) 감지.
      // 0행이면 FK가 평가되지 않으므로 404가 422보다 자연히 우선한다.
      const rows = await this.db
        .update(posts)
        .set(set)
        .where(and(eq(posts.id, id), eq(posts.authorId, authorId)))
        .returning({ id: posts.id });
      return rows.length > 0;
    } catch (e) {
      this.throwIfFkViolation(e);
      throw e;
    }
  }

  /**
   * @returns false = 비존재 또는 타인 글. S3 객체는 안 지운다(sweep GC 몫 — docs/todo.md)
   *
   * ⚠️ update와 같은 이유로 작성자가 탈퇴한 글은 이 경로로 삭제되지 않는다(운영자 SQL 몫).
   */
  async delete(id: string, authorId: string): Promise<boolean> {
    const rows = await this.db
      .delete(posts)
      .where(and(eq(posts.id, id), eq(posts.authorId, authorId)))
      .returning({ id: posts.id });
    return rows.length > 0;
  }

  /**
   * 비정규화 카운터 증감 — 좋아요·댓글 쓰기와 **같은 트랜잭션**에서 호출되어야 한다
   * (경계는 유스케이스의 `@Transactional()`이 잡는다). posts는 이 어댑터의 테이블이므로
   * 자식 쪽 writer가 아니라 여기가 소유한다.
   *
   * 읽고-더하고-쓰기가 아니라 SQL 식(`like_count + delta`)으로 원자 증감한다 — 동시 좋아요가
   * 서로를 덮어쓰지 않는 근거이고, E2E의 "다른 유저 동시 좋아요 → 카운터 2"가 이걸 지킨다.
   * updatedAt 자기대입으로 `$onUpdate`를 억제한다(좋아요·댓글 활동 ≠ 글 수정).
   *
   * @returns 갱신된 값. null = 그 글이 없다(호출자가 404로 번역).
   */
  async adjustLikeCount(postId: string, delta: 1 | -1): Promise<number | null> {
    const [row] = await this.db
      .update(posts)
      .set({
        likeCount: sql`${posts.likeCount} + ${delta}`,
        updatedAt: sql`${posts.updatedAt}`,
      })
      .where(eq(posts.id, postId))
      .returning({ likeCount: posts.likeCount });
    return row?.likeCount ?? null;
  }

  /**
   * adjustLikeCount의 배치판 — 계정 삭제가 유저의 좋아요를 한 번에 걷어낼 때 쓴다.
   * 카운터 규율은 동일(SQL 식 증감 + updatedAt 자기대입).
   *
   * 단건과 달리 RETURNING이 없다 — 배치엔 "그 글이 없다"의 404 의미가 없기 때문이다.
   * 인자로 오는 id들은 방금 지운 좋아요 행이 가리키던 글이라 존재가 구성으로 보장된다.
   *
   * ⚠️ inArray는 빈 배열에서 유효한 SQL을 만들지 못한다 — 좋아요 0개인 유저의 탈퇴가
   *    정상 경로이므로 호출자에 조건문을 심지 않고 여기서 거른다.
   * ⚠️ postIds가 Postgres bind 파라미터 상한(65535)에 근접하면 이 문장이 실패한다.
   *    현 규모에선 도달 불가 — 도달하면 `= any($1::uuid[])`(파라미터 1개)로 바꾼다.
   */
  async adjustLikeCounts(postIds: string[], delta: 1 | -1): Promise<void> {
    if (postIds.length === 0) return;
    await this.db
      .update(posts)
      .set({
        likeCount: sql`${posts.likeCount} + ${delta}`,
        updatedAt: sql`${posts.updatedAt}`,
      })
      .where(inArray(posts.id, postIds));
  }

  /** adjustLikeCount와 같은 규율 — 댓글 쓰기와 같은 트랜잭션에서 호출된다. */
  async adjustCommentCount(postId: string, delta: 1 | -1): Promise<void> {
    await this.db
      .update(posts)
      .set({
        commentCount: sql`${posts.commentCount} + ${delta}`,
        updatedAt: sql`${posts.updatedAt}`,
      })
      .where(eq(posts.id, postId));
  }

  // FK 위반(23503)을 도메인 예외로 변환 — 사전 SELECT 없음(§7의 23505 패턴과 같은 경로).
  private throwIfFkViolation(e: unknown): void {
    const cause = e instanceof DrizzleQueryError ? e.cause : e;
    if (
      !(cause instanceof DatabaseError) ||
      cause.code !== PG_ERROR_CODE.FOREIGN_KEY_VIOLATION
    ) {
      return; // 매치 안 되면 조용히 반환(호출부가 rethrow).
    }
    // body의 plantId가 비존재 카탈로그 — 422.
    if (cause.constraint === FK_POSTS_PLANT) {
      throw new ReferencedPlantNotFoundError();
    }
    // 탈퇴 직후 아직 만료 안 된 access token의 INSERT(무상태 검증이라 즉시 모름 — §10).
    // 요청 주체가 사라진 기대된 race → 500이 아니라 401(클라 복구 = 세션 폐기).
    if (cause.constraint === FK_POSTS_AUTHOR) {
      throw new UnauthenticatedError();
    }
  }
}
