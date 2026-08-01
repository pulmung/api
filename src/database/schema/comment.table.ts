import { index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { pgTable } from './pg-table';
import { users } from './user.table';
import { posts } from './post.table';

// 라우트 대상(postId)이 그 사이 삭제된 경우 INSERT가 23503 — 사전 SELECT 대신
// 이 이름으로 잡아 PostNotFoundError(404)로 변환한다(FK_POSTS_PLANT와 같은 경로).
export const FK_COMMENTS_POST = 'fk_comments_post';
// 탈퇴 직후 아직 유효한 access token의 INSERT — FK_POSTS_AUTHOR와 동일 결(401 변환).
// (authorId는 set null이지만 그건 *삭제 전파* 정책일 뿐이라 INSERT 시점의 23503은 그대로다.)
export const FK_COMMENTS_AUTHOR = 'fk_comments_author';
// ⚠️ load-bearing: 이 FK의 NO ACTION(문장 끝 검사)이 삭제 삼분기의 race-safe 판정자다.
// 아래 테이블 doc "삭제 정책" 참조 — onDelete를 달거나 RESTRICT로 바꾸면 설계가 깨진다.
export const FK_COMMENTS_PARENT = 'fk_comments_parent';
// body의 mentionedUserId가 비존재 유저 — 422 변환(REFERENCED_PLANT_NOT_FOUND와 같은 결).
export const FK_COMMENTS_MENTIONED_USER = 'fk_comments_mentioned_user';

/**
 * 댓글 — 물리 2계층 고정(인스타그램 모델): parentId는 항상 루트 댓글을 가리킨다.
 * "답글에 답글"은 같은 루트 밑의 형제 답글 + mentionedUserId(구조화 멘션)로 표현 —
 * 멘션을 텍스트로 선조립하지 않고 읽기 시 join으로 닉네임을 해석해 변경에도 신선하다.
 * 트리(무제한 중첩)는 의도적으로 배제 — materialized path 등 스키마·페이지네이션
 * 복잡도를 커뮤니티 성격이 정당화하지 못한다(§0 비용 계산).
 *
 * 삭제 정책(post.table.ts가 예고한 "댓글 생기면 재검토"의 결론):
 * - 답글 있는 루트 → soft delete(deletedAt set + content NULL) — 스레드 보존,
 *   목록에 "삭제된 댓글" 플레이스홀더. content NULL은 개인정보 최소화(§11) —
 *   삭제 요청된 본문을 보관하지 않는다. content NULL ⇔ deletedAt NOT NULL(앱 불변식).
 * - 답글 없는 루트·답글 → 하드 삭제. 답글은 자식이 없으므로 soft delete가 영원히 없다.
 * - 판정은 사전 EXISTS가 아니라 FK가 한다: 하드 DELETE를 먼저 시도하고, 살아있는
 *   답글이 있으면 fk_comments_parent(NO ACTION = 문장 끝 검사)가 23503을 던진다 →
 *   그때 soft delete로 전환. race-safe 무잠금(§7의 23505 패턴 FK 버전).
 *   NO ACTION이라 posts cascade(루트+답글이 한 문장에 삭제)는 통과한다 —
 *   RESTRICT는 즉시 검사라 cascade를 깨므로 금지.
 *
 * posts.commentCount 비정규화 — 댓글 INSERT/DELETE/soft delete와 같은 트랜잭션에서
 * 증감(comment.writer.ts가 소유). 카운트 = 살아있는(deletedAt IS NULL) 루트+답글.
 *
 * 회원탈퇴(계정 삭제) 유예 3건의 결말 — 탈퇴 feature 도입 시 정산했다:
 * ① **소멸** — authorId가 cascade → set null이 되어 users 삭제가 댓글 행을 직접 지우지
 *    않는다. 탈퇴자의 *자기 글*에 달린 댓글은 posts cascade로 사라지지만, 그건 루트+답글이
 *    한 문장에 지워지는 경로라 fk_comments_parent(NO ACTION)를 통과한다(위 "삭제 정책").
 *    즉 23503이 나던 경로 자체가 없어졌다.
 * ② **소멸** — 두 경로 모두 드리프트가 없다: 남의 글에 단 댓글은 안 지워지고, 자기 글의
 *    댓글은 그 글(=카운터를 든 행) 자체가 함께 사라진다.
 *    ⚠️ 앱 보정으로 푼 게 아니라 **정책 변경으로 구조적으로 없앴다**. authorId를 cascade로
 *    되돌리면 두 유예가 함께 되살아난다 — 이 컬럼의 onDelete는 load-bearing이다.
 * ③ **남음, 그리고 확대됐다** — 인덱스 없는 전파 컬럼이 여기 하나가 아니라 셋이다:
 *    comments.mentioned_user_id(set null) · sessions.user_id(cascade, 인덱스 0개) ·
 *    plants.created_by_id(set null). 계정 삭제가 이제 이 seq scan들을 실제로 발동시킨다.
 *    미도입 유지 — 계정당 1회 연산이고 "인덱스는 쿼리가 정한다"(이 컬럼들로 조회하는
 *    쿼리가 없다). **재검토 트리거**: 탈퇴 요청의 지연이 실제로 관측되거나 sessions가
 *    수십만 행 규모가 될 때. 유저 수 증가 자체는 트리거가 아니다.
 */
export const comments = pgTable(
  'comments',
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    // 글 삭제 = 스레드 소멸(cascade) — 루트·답글이 한 문장에 지워져 self-FK와 무충돌.
    postId: uuid()
      .notNull()
      .references(() => posts.id, { name: FK_COMMENTS_POST, onDelete: 'cascade' }),
    // 탈퇴 = 작성자만 소실(set null), 댓글은 남는다 — posts.authorId 전례(근거는 그쪽 doc).
    // 스레드 보존이 이 테이블의 삭제 정책이 세운 규율이므로 users cascade는 그 규율과
    // 모순이었다. ⚠️ load-bearing: 위 유예 ①②가 이 set null에 의존해 소멸한다.
    // ⚠️ 귀결: 작성자 없는 댓글은 수정·삭제 불가(ownedLive 술어가 NULL에 안 걸린다).
    authorId: uuid().references(() => users.id, {
      name: FK_COMMENTS_AUTHOR,
      onDelete: 'set null',
    }),
    // 루트면 NULL, 답글이면 루트 id(항상 루트 — 2계층 불변식은 usecase가 강제).
    // 답글의 postId = 루트의 postId(구성으로 보장 — usecase가 루트에서 복사).
    // self-FK 순환 추론 회피를 위해 반환 타입 명시(AnyPgColumn) 필요.
    // onDelete 없음(= NO ACTION) — 위 doc "삭제 정책"이 이 기본값에 의존한다.
    parentId: uuid().references((): AnyPgColumn => comments.id, {
      name: FK_COMMENTS_PARENT,
    }),
    // 구조화 멘션 — 답글에만(루트는 항상 NULL, 도메인 팩토리가 구조로 강제).
    // 멘션된 유저 탈퇴 시 멘션만 소멸(set null) — 답글 본문은 남는다.
    mentionedUserId: uuid().references(() => users.id, {
      name: FK_COMMENTS_MENTIONED_USER,
      onDelete: 'set null',
    }),
    // 플레인텍스트(HTML 아님 — 이스케이프는 클라 렌더 몫). 길이 제약은 Zod 경계가
    // 강제(코드베이스 관례). NULL ⇔ soft-deleted(위 doc) — 그 외 경로로 NULL 금지.
    content: text(),
    // NOT NULL = "삭제된 댓글" 플레이스홀더(루트 전용 상태 — 답글은 항상 하드 삭제).
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // (post_id, parent_id, id) 하나가 ① 루트 목록(WHERE post_id = ? AND parent_id IS NULL
    // AND id > ? ORDER BY id ASC — IS NULL도 btree 등호류라 정렬까지 통째로 커버)
    // ② posts cascade 삭제의 자식 행 스캔(leftmost prefix)을 겸한다(idx_posts_author 전례).
    index('idx_comments_post').on(t.postId, t.parentId, t.id),
    // (parent_id, id) — ③ 답글 목록 커서 ④ replyCount GROUP BY(index-only)
    // ⑤ fk_comments_parent의 자식 존재 검사 ⑥ 고아 플레이스홀더 정리 가드.
    index('idx_comments_parent').on(t.parentId, t.id),
    // users 삭제 시 SET NULL 전파의 대상 행 스캔 + 미래의 "내가 쓴 댓글" 목록(posts 전례).
    index('idx_comments_author').on(t.authorId, t.id),
  ],
);

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
