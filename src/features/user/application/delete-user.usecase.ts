import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { PostLikeWriter } from '../../post/repository/post-like.writer';
import { PostWriter } from '../../post/repository/post.writer';
import { UserNotFoundError } from '../domain/user.error';
import { UserWriter } from '../repository/user.writer';

/**
 * 회원탈퇴 — users 행의 하드 삭제 + 전파. 유예기간·복구·재인증·소셜 unlink 없음(확정 결정,
 * 각 기각 근거는 아래). 참조 테이블별 전파 정책의 전체 맵은 user.table.ts doc에 있다.
 *
 * ## 왜 앱이 명시적으로 지우는 게 post_likes 하나뿐인가
 *
 * FK 전파(cascade/set null)는 쓰기 어댑터를 **우회**하므로 비정규화 카운터를 드리프트시킨다.
 * 그래서 규율은 "cascade를 전부 앱으로 옮긴다"가 아니라 **"카운터를 드리프트시키는 것만
 * 앱이 지운다"** 이다:
 * - `post_likes` → **남의 글**의 `posts.likeCount`를 드리프트시킨다 → 여기서 지우고 카운터를
 *   함께 내린다. (자기 글에 달린 좋아요는 그 글이 cascade로 사라지며 카운터를 든 행도 함께
 *   없어지므로 무해하다 — 그래서 두 경우를 구분하지 않는다.)
 * - `posts` → cascade. 글이 통째로 사라지니 `commentCount`·`likeCount`를 든 행 자체가 없어져
 *   드리프트가 성립하지 않는다. 그 글의 댓글은 타인 것까지 함께 지워지는데, 이는 유저가 자기
 *   글을 직접 지울 때와 같은 동작이다(post.table.ts "글 삭제 = 스레드 전체 소멸").
 * - `comments`(남의 글에 단 것) → **set null이라 행이 안 지워진다** → `posts.commentCount`
 *   드리프트가 구조적으로 소멸(comment.table.ts 유예 ②의 해소 근거 — 앱 보정이 아니다).
 * - `sessions`·`user_plants`·`waterings`·`user_blocks` → 카운터 없음 → DB cascade에 맡긴다.
 *   앱으로 끌어오면 어댑터 4개를 주입하려고 모듈 4개를 import해야 하는데 사주는 게 0이다(§0).
 *
 * ## 순서가 load-bearing이다
 *
 * users DELETE는 **반드시 마지막**이다. 먼저 하면 cascade가 post_likes를 지워버려 "어떤 글의
 * 카운터를 내려야 하는지"를 알 방법이 사라진다 — 증거가 소실되는데 응답은 204로 나간다.
 * (`adjustLikeCounts`가 갱신하는 집합에는 곧 cascade로 사라질 본인 글도 섞이지만, 그 UPDATE는
 *  같은 트랜잭션 안에서 무해하게 버려진다 — 걸러내려고 쿼리를 늘릴 이유가 없다.)
 *
 * ## 왜 단일 트랜잭션인가 (좋아요가 많은 유저 시나리오)
 *
 * 좋아요 1000개면 ① `idx_post_likes_user` 스캔 1회로 1000행 삭제 + uuid 반환 ② PK 룩업
 * 1000건 UPDATE(그 글들은 커밋까지 row-exclusive 락) ③ users 1행 삭제 + 전파. 밀리초
 * 단위이고 락 경합 대상은 "그 글들에 지금 좋아요를 누르는 사람"뿐이다. 청크로 쪼개면 중간
 * 실패 시 **반쯤 삭제된 유저**가 남아 재개 메커니즘(잡·아웃박스)이 필요해지는데, 지금 없는
 * 인프라를 들여 얻는 게 밀리초짜리 락 단축이다(§0).
 * **재검토 트리거**: 한 유저의 post_likes가 수만 행이 되거나, 탈퇴 요청이 락 대기·타임아웃으로
 * 실제로 실패할 때. 유저 수 증가는 트리거가 아니다.
 *
 * ## 수용한 잔여 레이스
 *
 * ①이 끝난 뒤 ③이 users 행 락을 잡기 전에 이 유저의 **다른 기기**가 좋아요를 커밋하면, 그
 * 행은 ③의 cascade 백스톱에 조용히 지워져 `likeCount`가 +1 뜬다. 확률이 극히 낮고(본인 기기
 * 2대 동시 조작) 결과가 카운터 1 오차라 수용한다 — 이 코드베이스는 이미 같은 부류를 수용
 * 중이다(탈퇴 직후 유효 토큰의 INSERT → 23503 → 401). 닫고 싶으면 첫 문장으로
 * `SELECT 1 FROM users WHERE id = ? FOR UPDATE`를 넣으면 된다(FOR UPDATE는 FK 검사의
 * FOR KEY SHARE와 충돌하므로 그 순간부터 이 유저를 참조하는 INSERT가 전부 401로 확정된다).
 * **재검토 트리거**: 이 드리프트가 실제로 관측될 때.
 *
 * ## 동시 탈퇴 데드락 (40P01) — 측정해서 확인한 사실, 수용한다
 *
 * **lost update는 없다**(측정): 같은 글을 좋아요한 5명이 동시에 탈퇴해도 likeCount가 정확히
 * 0이 된다. `adjustLikeCounts`가 읽고-쓰기가 아니라 SQL 식이라 READ COMMITTED에서 두 번째
 * UPDATE가 행 락을 기다렸다가 **갱신된 값으로 재평가**하기 때문이다.
 *
 * **하지만 데드락은 난다**(측정): 서로의 글에 좋아요한 두 유저가 동시에 탈퇴하면 40P01이
 * 재현된다. 각 트랜잭션이 "상대의 글"을 먼저 잡고 "자기 글"(상대가 잡은 것)을 나중에
 * 요구하기 때문 — 락 순서가 서로 반대다.
 *
 * ⚠️ **이건 이 유스케이스의 문제가 아니다.** `adjustLikeCounts`를 완전히 빼고 `DELETE FROM
 * users` 두 개만 동시에 돌려도 5회 중 4회 40P01이 났다(나머지는 락 대기). users cascade가
 * 서로의 `post_likes` 행을 반대 순서로 잡기 때문이라, **상호작용한 두 유저의 동시 탈퇴에
 * 내재된 성질**이다. postIds를 정렬해도 안 없어진다(같은 문장 안의 순서 문제가 아니다).
 *
 * **그래서 고치지 않는다**: ① 발생 조건이 "서로 상호작용한 두 유저가 밀리초 단위로 동시에
 * 탈퇴"라 극히 드물다 ② Postgres가 1초 안에 감지해 **정확히 한쪽만** abort시킨다 — 손상이
 * 아니라 에러다 ③ 이 메서드는 단일 `@Transactional()`이라 victim은 **통째로 롤백**된다
 * (반쯤 삭제된 유저가 남지 않는다) ④ 남는 비용은 그 한 명이 500을 받고 다시 누르면 되는
 * 것뿐이다. 자동 재시도는 이 레포에 없는 인프라이고, 이 확률에 도입할 값이 아니다(§0).
 * **재검토 트리거**: 40P01이 로그에 실제로 쌓이거나, 재시도 인프라가 다른 이유로 생길 때.
 *
 * ## 하지 않기로 한 것 (기각 — 다시 제안되지 않도록)
 *
 * - **소셜 연결 끊기(unlink)**: 탈퇴 경로에 외부 HTTP를 넣으면 "실패하면 탈퇴를 막나"가 즉시
 *   따라오고(트랜잭션 밖으로 빼야 한다) best-effort로 두면 애매한 상태가 남는다. 연결 해제는
 *   유저가 카카오/구글 설정에서 한다. **재검토 트리거**: Apple 로그인 추가(계정 삭제 시 토큰
 *   revoke가 실제 요구사항이다) 또는 카카오 검수에서 요구받을 때.
 * - **재가입 쿨다운**: 탈퇴 계정의 provider 식별자를 보관해야 하는데 §11 최소수집과 충돌한다.
 *   **재검토 트리거**: 탈퇴-재가입을 통한 차단 회피가 실제 패턴으로 관측될 때.
 * - **유예기간(복구 가능한 탈퇴)**: soft delete 기간 동안 글·닉네임을 어떻게 보일지가 전파
 *   정책 전체를 다시 열어버린다. 복구 요구가 실제로 생기면 그때.
 * - **탈퇴 시 재인증**: 소셜 로그인이라 비밀번호 재확인이 불가능하고, 소셜 SDK 재호출을
 *   강제하는 것은 큰 마찰이다. access token 수명이 짧은 것으로 충분하다고 판단.
 */
@Injectable()
export class DeleteUserUseCase {
  constructor(
    private readonly postLikeWriter: PostLikeWriter,
    private readonly postWriter: PostWriter,
    private readonly userWriter: UserWriter,
  ) {}

  @Transactional()
  async execute(command: { id: string }): Promise<void> {
    // 좋아요를 먼저 걷어내고, 그 반환값이 곧 감소 대상이다 — "지운 것"과 "감소시킬 것"이
    // 같은 값이라 틀린 집합을 감소시킬 수 없다(순서·증거는 위 doc).
    const likedPostIds = await this.postLikeWriter.deleteAllByUser(command.id);
    await this.postWriter.adjustLikeCounts(likedPostIds, -1);

    const deleted = await this.userWriter.delete(command.id);
    // 무상태 JWT의 sub가 가리키는 행이 이미 없을 수 있다 — GET/PATCH /users/me와 동일한 404.
    // 여기서 던지면 위 두 문장도 롤백되지만, 유저가 없으면 그 문장들도 0행이라 잃는 게 없다.
    if (!deleted) throw new UserNotFoundError();
  }
}
