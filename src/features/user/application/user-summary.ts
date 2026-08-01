import type { PublicFileUrlResolver } from '../../file/infrastructure/public-file-url.resolver';

/**
 * 유저를 "남에게 보여줄 때"의 읽기 모델 — 응답으로 흐르는 경계라 명시 타입(§5).
 * presentation의 `UserSummarySchema`와 짝이며(같은 모양의 zod 쪽), user가 소유하는
 * 이유도 같다: 바뀌는 계기가 "유저를 어떻게 요약하나"이지 소비처의 사정이 아니다.
 */
export type UserSummaryView = {
  id: string;
  nickname: string;
  // null = 아바타 미설정. 기본 이미지는 클라 소유다(user.table.ts profileImageKey doc).
  profileImageUrl: string | null;
};

// reader가 내보내는 행 모양 — `userSummaryColumns()`(repository/user-summary.columns.ts)의
// 반환과 짝이다. 여기서 key → URL 변환이 일어난다(reader는 순수 DB 접근이라 URL을 모른다, §2).
// export하는 이유: 소비처 query service가 자기 매핑 함수의 row 파라미터를 이 타입으로
// 적는다(추론이 닿지 않는 private 메서드 경계 — 인라인하면 또 복제가 시작된다).
export type UserSummaryRow = {
  id: string;
  nickname: string;
  profileImageKey: string | null;
};

export function toUserSummaryView(
  row: UserSummaryRow,
  urlResolver: PublicFileUrlResolver,
): UserSummaryView {
  return {
    id: row.id,
    nickname: row.nickname,
    profileImageUrl: row.profileImageKey
      ? urlResolver.resolve(row.profileImageKey)
      : null,
  };
}

/**
 * left join이 미매칭이면 drizzle이 객체째 null로 접는다 — 그 null을 그대로 통과시킨다.
 * 소비처: 작성자 탈퇴(comments.authorId set null)·멘션 없음/멘션 유저 탈퇴.
 * ⚠️ 여기서 던지면 탈퇴 유저가 낀 페이지 전체가 500이 된다 — author null은 불변식 위반이
 * 아니라 **합법 상태**다(comment-query.service의 비대칭 가드 주석과 같은 근거).
 */
export function toUserSummaryViewOrNull(
  row: UserSummaryRow | null,
  urlResolver: PublicFileUrlResolver,
): UserSummaryView | null {
  return row === null ? null : toUserSummaryView(row, urlResolver);
}
