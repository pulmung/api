import { index, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from './pg-table';
import { users } from './user.table';

// 차단 대상(blockedId)이 그 사이 탈퇴한 경우 INSERT가 23503 — 사전 SELECT 대신 이 이름으로
// 잡아 404로 변환한다(FK_POST_LIKES_POST와 같은 경로).
export const FK_USER_BLOCKS_BLOCKED = 'fk_user_blocks_blocked';
// 탈퇴 직후 아직 유효한 access token의 INSERT — FK_POST_LIKES_USER와 동일 결(401 변환).
export const FK_USER_BLOCKS_BLOCKER = 'fk_user_blocks_blocker';
// "한 유저가 한 상대를 차단하는 건 한 번"의 유니크 제약 = 복합 PK 자신.
// 멱등(onConflictDoNothing)의 근거이며, PK_POST_LIKES와 같은 결이다 — 이 **이름 상수**는
// 명시적 네이밍용이고 writer의 onConflict는 컬럼 목록으로 인덱스를 추론한다.
export const PK_USER_BLOCKS = 'pk_user_blocks';

/**
 * 유저 차단 — (blocker, blocked) 관계 자체가 리소스인 순수 관계 테이블(post_likes 전례).
 * surrogate id 없음·updatedAt 없음도 같은 이유다(API가 자기 id로 지칭하지 않고, 주소는
 * 항상 (나, 상대). 수정이 존재하지 않는 불변 행 — 생성/삭제만).
 *
 * ⚠️ **저장은 단방향, 효과는 양방향** — 이 테이블 설계의 핵심이다.
 * A가 B를 차단하면 행은 (A, B) 하나지만, 읽기 필터는 **A도 B를 못 보고 B도 A를 못 보게**
 * 해야 한다. 단방향 효과(차단한 쪽만 안 보임)면 차단이 괴롭힘 방어로 기능하지 않는다 —
 * B는 여전히 A의 글을 찾아 읽고 댓글을 단다. 주요 SNS(인스타·트위터)의 표준 동작이고,
 * 우리도 이걸 따른다. 그래서 제외 조건이 두 방향이며, **독립된 NOT EXISTS 두 개**로 쓴다:
 *   AND NOT EXISTS (… blocker=me     AND blocked=author)   → pk_user_blocks 점조회
 *   AND NOT EXISTS (… blocker=author AND blocked=me)       → idx_user_blocks_blocked 점조회
 * 하나의 서브쿼리에 OR로 합치지 않는다 — 서브쿼리 **안**의 OR는 플래너가 anti-join으로
 * 접지 못해 인덱스를 흘릴 수 있다. 아래 인덱스 2개가 각 항을 하나씩 커버하며, 역방향
 * 인덱스는 편의가 아니라 **차단 의미론이 요구하는 것**이다.
 * 조건의 단일 소스는 `features/moderation/repository/block-filter.ts`의 `excludeBlocked()` —
 * 손으로 반복하면 빠뜨리는데 빠뜨려도 신호가 없다(조용한 fail-open, architecture.md §2-1).
 *
 * **효과 범위(합의된 결정)**: 목록 숨김만 한다.
 * - **상세 URL 직접 접근은 그대로 보여준다.** 공개 게시판이라 로그아웃·시크릿창으로 우회
 *   가능하므로 이건 보안 경계가 아니라 **UX 필터**다 — 우회되는 것을 막느라 복잡도를 쓰지
 *   않는다. (계정 관계 중심 SNS는 상세도 막지만, 그쪽은 비공개 프로필이 전제다.)
 * - **이미 달린 댓글·좋아요는 정리하지 않는다.** 소급 삭제는 상대에게 차단 사실을 알리는
 *   신호가 되고(차단은 조용해야 한다) 스레드에 구멍을 낸다. 차단은 앞으로의 노출만 막는다.
 * - **`posts.commentCount` 드리프트는 수용한다.** 비정규화 컬럼이라 뷰어별 필터가 불가능해
 *   "댓글 12개"인데 11개만 보일 수 있다(주요 SNS도 동일). 단 `replyCount`는 실시간 집계라
 *   필터를 적용한다 — 같은 화면 안에서 "답글 N개"를 눌러 다른 수가 나오면 즉시 드러나므로
 *   (comment.reader.ts replyCounts doc).
 *
 * 뮤트(mute)는 별개 개념이라 여기 섞지 않는다 — 차단은 상호 격리, 뮤트는 "나만 안 봄"
 * (상대는 모르고 상호작용도 가능). 요구가 생기면 별도 테이블로 additive.
 *
 * self-block(blocker == blocked) 금지에 DB CHECK를 두지 않는다 — 이 코드베이스 관례
 * (user_plants.wateringIntervalDays 범위 제약도 DB가 아닌 경계 검증이 강제한다).
 * 유니크와 달리 이건 **race가 없는 불변식**이다: 두 값 모두 요청 자체에서 오고 동시성이
 * 개입할 여지가 없으므로 usecase 비교 한 줄이면 충분하다. DB 제약이 신뢰의 원천이어야
 * 하는 건 "동시에 두 요청이 들어오면 앱 검사가 뚫리는" 부류(23505)에 한한다(§7).
 *
 * 차단 시 기존 상호작용(좋아요·댓글)은 정리하지 않는다 — 소급 삭제는 상대에게 차단
 * 사실을 알리는 신호가 되고(차단은 조용해야 한다), 스레드에 구멍을 낸다. 차단은
 * **앞으로의 노출**만 막는다.
 */
export const userBlocks = pgTable(
  'user_blocks',
  {
    // 차단한 사람. 탈퇴 = 그가 건 차단도 소멸(cascade) — post_likes.userId 전례.
    blockerId: uuid()
      .notNull()
      .references(() => users.id, {
        name: FK_USER_BLOCKS_BLOCKER,
        onDelete: 'cascade',
      }),
    // 차단당한 사람. 탈퇴 = 차단할 대상이 사라짐(cascade). 신고(reports)와 달리 여기엔
    // 보존할 이력 가치가 없다 — 차단은 "지금 안 보이게 하라"는 상태이지 기록이 아니다.
    blockedId: uuid()
      .notNull()
      .references(() => users.id, {
        name: FK_USER_BLOCKS_BLOCKED,
        onDelete: 'cascade',
      }),
    // 차단 시점(감사·차단 목록 정렬). 사유 컬럼은 두지 않는다 — 차단은 사유를 묻지 않는
    // 일방적 개인 조치다(사유가 필요한 건 신고 쪽이고, 그건 reports가 받는다).
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // (blocker_id, blocked_id) — ① 중복 차단 방지(멱등의 근거) ② "내 차단 목록"
    // ③ 정방향 필터(내가 차단했나) ④ users cascade의 blocker 쪽 자식 스캔.
    primaryKey({ name: PK_USER_BLOCKS, columns: [t.blockerId, t.blockedId] }),
    // (blocked_id, blocker_id) — ① **역방향 필터(상대가 나를 차단했나)** = 위 doc의
    // 양방향 효과, 두 번째 NOT EXISTS가 이걸 탄다 ② users cascade의 blocked 쪽 자식 스캔
    // (PK는 blocker_id 선두라 못 탄다). 두 컬럼 모두 포함해 index-only로 끝난다(post_likes 전례).
    index('idx_user_blocks_blocked').on(t.blockedId, t.blockerId),
  ],
);

export type UserBlock = typeof userBlocks.$inferSelect;
export type NewUserBlock = typeof userBlocks.$inferInsert;
