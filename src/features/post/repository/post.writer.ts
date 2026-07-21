import { Inject, Injectable } from '@nestjs/common';
import { DatabaseError } from 'pg';
import { and, DrizzleQueryError, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
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
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

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

  /** @returns false = 비존재 또는 타인 글 (구분하지 않는다 — 존재 은닉) */
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

  /** @returns false = 비존재 또는 타인 글. S3 객체는 안 지운다(sweep GC 몫 — docs/todo.md) */
  async delete(id: string, authorId: string): Promise<boolean> {
    const rows = await this.db
      .delete(posts)
      .where(and(eq(posts.id, id), eq(posts.authorId, authorId)))
      .returning({ id: posts.id });
    return rows.length > 0;
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
