import { and, eq, notExists, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { DrizzleDB } from '../../../database/drizzle.constants';
import { userBlocks } from '../../../database/schema';

/**
 * 차단 가시성 필터 — **뷰어별 목록 쿼리의 단일 소스**.
 *
 * 목록 읽기 경로마다 손으로 조건을 쓰지 않는다. 이유는 스타일이 아니라 실패 모드다:
 * 이 조건이 빠진 쿼리는 **아무 신호 없이 차단된 유저의 콘텐츠를 노출한다**(조용한
 * fail-open). architecture.md §10이 인증 opt-in에서 인정한 위험과 같은 부류지만 더
 * 나쁘다 — 인증 데코 누락은 `@CurrentUser()`가 undefined라 대개 TypeError로 터지는데,
 * 이건 정상 응답으로 보인다. 그래서 ① 조각을 한 곳에 두고 ② 라우트별 E2E로 묶는다
 * (test/block-filter.e2e-spec.ts).
 *
 * **왜 NOT EXISTS 두 개인가** (하나에 OR를 넣지 않는다):
 * 차단은 저장이 단방향이고 효과가 양방향이라(user-block.table.ts doc) 두 방향을 모두
 * 봐야 한다. 그런데 서브쿼리 **안**의 OR는 플래너가 anti-join으로 접지 못해 인덱스를
 * 흘릴 수 있다. 각 방향을 순수 등호 2개짜리 독립 NOT EXISTS로 쪼개면 각각
 * pk_user_blocks / idx_user_blocks_blocked를 정확히 점조회한다.
 *
 * **왜 SQL에 넣나** (앱에서 후처리하지 않는다):
 * ① 후처리는 필터된 행이 이미 와이어를 넘어왔다는 뜻이 아니라(서버 내부이긴 하다)
 *    **페이지 크기를 깨뜨린다** — limit 20을 받아 3개를 버리면 17개가 나간다.
 *    WHERE에 있으면 DB가 필터 통과 행으로 limit+1을 채우므로 이 문제가 없다.
 * ② 클라 필터링은 더 나쁘다 — 차단한 상대의 닉네임·본문이 응답 JSON에 실려 나간다.
 *
 * @param viewerId 없으면(익명 열람) `undefined`를 반환한다 — 차단은 뷰어별 개념이라
 *   익명에겐 존재하지 않는다. 호출부는 반환값을 `and(...)`에 그대로 끼우면 된다
 *   (drizzle의 and가 undefined를 건너뛴다 — `cursor ? gt(...) : undefined` 관례와 동일).
 * @param authorId 필터 대상 행의 작성자 컬럼(`posts.authorId`·`comments.authorId` 등).
 *   컬럼 참조로 받으므로 상관 서브쿼리가 각 행마다 평가된다.
 *   **NULL-safe다**(= 작성자가 탈퇴한 행). `blocked_id = NULL`이 UNKNOWN이라 서브쿼리가
 *   0행을 내고 `NOT EXISTS(empty)`는 TRUE → 두 항 모두 통과해 행이 살아남는다. 이게
 *   의도다 — 차단은 사람 대 사람 관계인데 상대가 존재하지 않으므로 가릴 것이 없다.
 *   ⚠️ 이 성질은 anti-join 형태에서만 성립한다. `NOT IN (서브쿼리)`로 "단순화"하면
 *   서브쿼리가 NULL을 하나라도 내는 순간 전체가 UNKNOWN이 되어 **모든 행이 사라진다**.
 *   위 "왜 NOT EXISTS 두 개인가"는 인덱스 때문에 고른 형태지만 이 안전성을 함께 준다.
 */
export function excludeBlocked(
  db: DrizzleDB,
  viewerId: string | undefined,
  authorId: PgColumn,
): SQL | undefined {
  if (!viewerId) return undefined;

  return and(
    // 내가 작성자를 차단했나 — pk_user_blocks (blocker_id, blocked_id) 점조회.
    notExists(
      db
        .select({ one: sql`1` })
        .from(userBlocks)
        .where(
          and(
            eq(userBlocks.blockerId, viewerId),
            eq(userBlocks.blockedId, authorId),
          ),
        ),
    ),
    // 작성자가 나를 차단했나 — idx_user_blocks_blocked (blocked_id, blocker_id) 점조회.
    // 이 두 번째 항이 "효과는 양방향"의 실체다. 빠지면 차단당한 쪽이 여전히 상대 글을
    // 보고 댓글을 달 수 있어 차단이 괴롭힘 방어로 기능하지 않는다.
    notExists(
      db
        .select({ one: sql`1` })
        .from(userBlocks)
        .where(
          and(
            eq(userBlocks.blockerId, authorId),
            eq(userBlocks.blockedId, viewerId),
          ),
        ),
    ),
  );
}
