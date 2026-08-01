import { timestamp, uuid, text, unique } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { pgTable } from './pg-table';
import { socialProviders } from '../../features/user/domain/social-provider';

export const UNIQUE_USERS_NICKNAME = 'uq_users_nickname';
export const UNIQUE_USERS_PROVIDER_ACCOUNT = 'uq_users_provider_account';

/**
 * 유저 = 계정. 소셜 신원 하나에 1:1(멀티 소셜 연결은 필요해질 때 SocialAccount로 분리 — §3).
 *
 * ## 계정 삭제(회원탈퇴)의 전파 맵 — 이 테이블이 허브다
 *
 * `DELETE /users/me`는 이 행을 **하드 삭제**한다(유예기간·복구 없음). users를 참조하는
 * 테이블이 8개라 전파 정책이 흩어지기 쉬우므로 여기에 모은다. 각 정책은 아래 판정 기준
 * 하나에서 나온다 — 규칙을 외우지 말고 기준을 적용할 것.
 *
 * **판정 ①: 그 테이블이 "본인이 직접 지울 때" 어떻게 동작하나?**
 *   탈퇴는 그 동작을 일괄 적용한 것이어야 한다 — "하나씩 다 지우고 탈퇴"와 "그냥 탈퇴"의
 *   결과가 달라질 이유가 없다. 그래서 글은 소멸하고(글 삭제 = 스레드 전체 소멸이 이
 *   레포의 게시판 관례 — post.table.ts) 댓글은 남는다(답글이 있으면 자리를 지키는 것이
 *   댓글의 삭제 삼분기 — comment.table.ts). **두 정책이 갈리는 건 절충이 아니라 일관성이다.**
 * **판정 ②: 그 행을 지우는 것이 비정규화 카운터를 드리프트시키는가?**
 *   FK 전파(cascade/set null)는 쓰기 어댑터를 **우회**하므로 카운터가 조용히 어긋난다.
 *   그런 테이블만 앱이 명시적으로 지운다. 아니면 DB cascade에 맡긴다(어댑터를 유스케이스로
 *   끌어오는 비용만 들고 사주는 게 0이다 — §0).
 *
 * | 참조 | 정책 | 판정 |
 * | --- | --- | --- |
 * | `post_likes.userId` | **앱 명시 삭제** (+ cascade 백스톱) | ②카운터 O(남의 글 `likeCount`) |
 * | `posts.authorId` | cascade (→ 그 글의 `comments`·`post_likes` 2단) | ①글 삭제 = 스레드 소멸 ②글이 사라지니 카운터도 함께 소멸 |
 * | `sessions.userId` | cascade | ①개인 활동 ②카운터 X |
 * | `user_plants.ownerId` | cascade (→ `waterings` 2단) | ①개인 활동 ②카운터 X |
 * | `user_blocks.blocker/blockedId` | cascade | ①상태이지 이력이 아니다 ②카운터 X |
 * | `comments.authorId` | **set null** | ①답글이 달렸으면 자리를 지킨다 |
 * | `comments.mentionedUserId` | set null | ①답글 본문은 남고 멘션만 소멸 |
 * | `reports.reporterId` | set null | 신고자 사정으로 위반 이력이 지워지면 안 된다 |
 * | `plants.createdById` | set null | 카탈로그는 공유 자산 |
 *
 * ⚠️ `comments`는 두 경로로 갈린다 — **남의 글**에 단 댓글은 set null로 남고(작성자 표시만
 *    사라진다), **자기 글**에 달린 댓글은 타인 것까지 posts cascade로 함께 사라진다.
 *    후자는 루트+답글이 한 문장에 지워져 `fk_comments_parent`(NO ACTION)를 통과한다.
 *
 * ⚠️ 순서가 load-bearing이다 — 명시 삭제는 users DELETE **전에** 끝나야 한다.
 *    상세·수용한 레이스는 `features/user/application/delete-user.usecase.ts` doc.
 * ⚠️ 재가입 제한 없음: 이 행이 사라지면 `uq_users_provider_account`·`uq_users_nickname`이
 *    함께 풀려 같은 소셜 계정으로 즉시 재가입되고 닉네임도 재사용 가능해진다. 쿨다운을
 *    두려면 탈퇴 계정의 provider 식별자를 보관해야 하는데 §11 최소수집과 충돌한다.
 *    **재검토 트리거**: 탈퇴-재가입을 통한 차단 회피가 실제 패턴으로 관측될 때.
 */
export const users = pgTable(
  'users',
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    provider: text({ enum: socialProviders }).notNull(),
    providerUserId: text().notNull(),
    // 소셜이 이메일을 안 줄 수 있다(카카오 미동의/Apple 비공개 릴레이 등). 식별이 아니라 프로필 데이터.
    email: text(),
    // 유저가 직접 입력. 전역 유니크 — 중복 닉네임 금지.
    nickname: text().notNull().unique(UNIQUE_USERS_NICKNAME),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique(UNIQUE_USERS_PROVIDER_ACCOUNT).on(t.provider, t.providerUserId),
  ],
);

// 타입 추론: 쿼리 결과(select) / 삽입(insert)용 타입을 스키마에서 자동 생성
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
