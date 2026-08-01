import type { PgColumn } from 'drizzle-orm/pg-core';

// `users` 본체와 `alias(users, ...)` 결과를 모두 받는다. `Pick<typeof users, ...>`로는 안
// 된다 — 별칭 테이블의 컬럼은 `tableName`이 'mentioned_users'라 본체 타입과 불일치한다.
// 필요한 컬럼 3개만 구조적으로 요구하면 양쪽을 받으면서 select 추론은 인자별로 정확하다
// (block-filter.ts가 `authorId: PgColumn`으로 posts·comments를 함께 받는 것과 같은 형태).
type UserSummarySource = {
  id: PgColumn;
  nickname: PgColumn;
  profileImageKey: PgColumn;
};

/**
 * 작성자 요약의 **projection 단일 소스** — 남의 feature가 users를 join해 유저를 요약할 때
 * 쓴다(post.reader의 author, comment.reader의 author·mentionedUser, user-block.reader의 user).
 *
 * **왜 user가 소유하나**: 이 모양이 바뀌는 계기는 "유저를 어떻게 요약하나"이지 글·댓글·차단의
 * 사정이 아니다 — presentation의 `UserSummarySchema`를 user가 소유하는 것과 같은 근거이고,
 * 그 파일 주석이 경고한 "소비처가 같은 모양을 인라인 복제한다(실제 발생 사례)"를 읽기
 * 쪽에서도 구조적으로 막는다. 아바타 추가 때 실제로 3개 reader를 동시에 고쳐야 했다.
 *
 * **왜 DI가 아니라 파일 import인가**: DI 프로바이더로 만들면 post·comment·moderation이
 * `UserModule`을 import해야 한다. 순수 조각은 파일 경계로 공개한다 — `excludeBlocked`
 * (moderation/repository/block-filter.ts)가 이미 쓰는 패턴이다(moderation.module doc).
 *
 * **왜 상수가 아니라 함수인가**: comment.reader가 `alias(users, 'mentioned_users')`로 같은
 * 테이블을 한 쿼리에서 두 번 조인한다 — 별칭 테이블을 인자로 받아야 두 조인을 같은 조각으로
 * 덮을 수 있다.
 *
 * ⚠️ 반환은 **불투명 key**(`profileImageKey`)다. 읽기 URL 조합은 reader가 아니라 조합
 * 레이어(query service)의 몫 — `toUserSummaryView`(application/user-summary.ts)가 짝이다.
 */
// 반환을 `Pick<T, ...>`로 **명시**한다 — 추론에 맡기면 제약(`PgColumn` 기본 제네릭)으로
// 넓어져 drizzle의 select 결과가 전부 `unknown`이 된다(경계는 명시, §5의 실제 사례).
export function userSummaryColumns<T extends UserSummarySource>(
  t: T,
): Pick<T, 'id' | 'nickname' | 'profileImageKey'> {
  return {
    id: t.id,
    nickname: t.nickname,
    profileImageKey: t.profileImageKey,
  };
}
