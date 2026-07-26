import { index, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from './table';
import { users } from './user.schema';
import { posts } from './post.schema';

// 라우트 대상(postId)이 그 사이 삭제된 경우 INSERT가 23503 — 사전 SELECT 대신
// 이 이름으로 잡아 404로 변환한다(FK_COMMENTS_POST와 같은 경로).
export const FK_POST_LIKES_POST = 'fk_post_likes_post';
// 탈퇴 직후 아직 유효한 access token의 INSERT — FK_COMMENTS_AUTHOR와 동일 결(401 변환).
export const FK_POST_LIKES_USER = 'fk_post_likes_user';
// "한 유저·한 글에 좋아요 하나"의 유니크 제약 = 복합 PK 자신. 멱등(onConflictDoNothing)의
// 근거가 이 제약이다 — 다만 이 **이름 상수**는 제약의 명시적 네이밍용일 뿐, writer가 쓰는
// 값은 아니다: drizzle의 onConflictDoNothing은 제약 이름이 아니라 컬럼 목록으로 인덱스를
// 추론한다(`on conflict ("post_id","user_id")`). UNIQUE_WATERINGS_PLANT_DATE와 같은 결.
export const PK_POST_LIKES = 'pk_post_likes';

/**
 * 게시글 좋아요 — (post, user) 관계 자체가 리소스인 순수 관계 테이블.
 *
 * surrogate id(uuidv7) 없음 — 의도된 결정: uuidv7 PK 컨벤션은 엔티티 테이블 기준이고,
 * 좋아요는 ① API가 자기 id로 지칭할 일이 없으며(주소는 항상 (postId, 나)) ② FK로
 * 참조하는 자식도 없다. 복합 PK가 유니크 제약을 겸해 인덱스 하나로 중복 방지·존재
 * 확인·posts cascade 자식 스캔을 모두 커버한다(§0 — 관성이 아니라 값 계산).
 *
 * updatedAt 없음 — 수정이 존재하지 않는 불변 행(생성/삭제만).
 *
 * posts.likeCount 비정규화 — 증감은 좋아요 쓰기 어댑터가 INSERT/DELETE와 같은
 * 트랜잭션에서 수행(comment.writer.ts의 commentCount와 동일 규율 — updatedAt
 * 자기대입으로 $onUpdate 억제. 멱등 경로에선 실제 삽입/삭제된 행 수만큼만 증감).
 * ⚠️ 회원탈퇴 유예: users cascade는 쓰기 어댑터를 우회하므로 likeCount가 드리프트한다
 * (comment.schema.ts 유예 ②와 같은 결 — 탈퇴 feature가 오케스트레이션으로 풀 것).
 */
export const postLikes = pgTable(
  'post_likes',
  {
    // 글 삭제 = 좋아요도 소멸(cascade) — comments.postId 전례.
    postId: uuid()
      .notNull()
      .references(() => posts.id, {
        name: FK_POST_LIKES_POST,
        onDelete: 'cascade',
      }),
    // 탈퇴 = 좋아요도 소멸(cascade) — posts.authorId 전례. 단 위 likeCount 유예 참조.
    userId: uuid()
      .notNull()
      .references(() => users.id, {
        name: FK_POST_LIKES_USER,
        onDelete: 'cascade',
      }),
    // 좋아요 누른 실제 시점(감사·미래 "내가 좋아요한 글" 정렬 보조).
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // (post_id, user_id) — ① 중복 좋아요 방지(멱등의 근거) ② "내가 이 글에 좋아요
    // 했는지" 점조회 ③ posts cascade 삭제의 자식 행 스캔(leftmost prefix)을 겸한다.
    primaryKey({ name: PK_POST_LIKES, columns: [t.postId, t.userId] }),
    // (user_id, post_id) — ① users cascade 삭제의 자식 행 스캔(PK는 post_id 선두라
    // 못 탄다) ② 목록의 "내가 좋아요 했는지" 배치 확인(WHERE user_id = ? AND
    // post_id IN (…))을 index-only로 ③ 미래 "내가 좋아요한 글" 목록(idx_comments_author 전례).
    index('idx_post_likes_user').on(t.userId, t.postId),
  ],
);

export type PostLike = typeof postLikes.$inferSelect;
export type NewPostLike = typeof postLikes.$inferInsert;
