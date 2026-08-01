import { Injectable } from '@nestjs/common';
import { PublicFileUrlResolver } from '../../file/infrastructure/public-file-url.resolver';
import { UserBlockReader } from '../../moderation/repository/user-block.reader';
import type { SocialProvider } from '../domain/social-provider';
import { UserReader } from '../repository/user.reader';
import { toUserSummaryView, type UserSummaryView } from './user-summary';

// 내 프로필 읽기 모델 — 응답으로 흐르는 경계 → 명시 타입(§5).
// ⚠️ provider·email은 **본인에게만** 나가는 값이다. 남에게 보여줄 표현은 `UserSummaryView`
// (application/user-summary.ts)이고 둘을 합치지 않는다 — 변경 이유가 다르다(§9).
export type MyProfile = {
  id: string;
  provider: SocialProvider;
  email: string | null;
  nickname: string;
  profileImageUrl: string | null;
  createdAt: string;
};

/**
 * 남의 프로필 읽기 모델 — 경계라 명시 타입(§5).
 *
 * `UserSummaryView`(작성자 표시용)에서 파생한다 — 같은 유저를 글 목록과 프로필에서 다르게
 * 그리면 안 되므로, 요약에 필드가 늘면 프로필도 따라와야 한다. 응답 DTO도 같은 축으로
 * 파생돼 있다(`UserDetailSchema = UserSummarySchema.extend(...)`).
 *
 * `MyProfile`과 합치지 않는다 — 저쪽은 provider·email이 함께 나가는 본인 전용 표현이라
 * 변경 이유가 다르다(위 MyProfile doc의 경고가 이 타입을 가리킨다).
 */
export type PublicProfile = UserSummaryView & {
  createdAt: string;
  // 단방향 — "내가 이 유저를 차단했나". 역방향은 노출하지 않는다(UserBlockReader.existsBlock doc).
  isBlocked: boolean;
};

/**
 * 읽기 조합 레이어(CQRS의 쿼리 핸들러 자리) — reader 행 + 파일 URL을 read model로 빚는다.
 *
 * 원래 `GET /users/me`는 조합이 0이라 controller → reader 직행이었는데(§2), 아바타의
 * key → 읽기 URL 변환이 생기면서 조합이 붙었다. 컨트롤러에 resolver를 주입하는 대안은
 * presentation이 infrastructure를 직접 아는 모양이라 의존 방향을 어긴다.
 * (조합이 얇아도 이 레이어를 두는 근거는 BlockQueryService doc 참조.)
 */
@Injectable()
export class UserQueryService {
  constructor(
    private readonly reader: UserReader,
    private readonly urlResolver: PublicFileUrlResolver,
    // 차단은 moderation 소유 — 여기선 읽기만 한다(user.module doc의 방향 근거).
    private readonly blockReader: UserBlockReader,
  ) {}

  /** null = 비존재. 무상태 JWT라 "행이 사라진 토큰"이 표현 가능하다 — 호출자가 404로 번역. */
  async findMyProfile(id: string): Promise<MyProfile | null> {
    const row = await this.reader.findById(id);
    if (!row) return null;

    return {
      id: row.id,
      provider: row.provider,
      email: row.email,
      nickname: row.nickname,
      profileImageUrl: row.profileImageKey
        ? this.urlResolver.resolve(row.profileImageKey)
        : null,
      // z.iso.datetime()은 Date를 거부한다 — 문자열 직렬화는 여기서(post 전례).
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * 남의 프로필(공개 표현). `null` = 비존재 → 호출자가 404로 번역한다(탈퇴 유저도 여기로 온다).
   *
   * 차단한 상대여도 **가린 채로 200을 준다** — 차단의 효과 범위는 "목록에서 숨김"이고 상세
   * 직접 접근은 유지하기로 이미 정해져 있다(user-block.table.ts doc). 프로필만 404로 만들면
   * 그 규율이 라우트마다 갈린다.
   *
   * @param viewerId 없으면(익명) 차단 조회를 아예 내지 않는다 — 차단은 뷰어별 개념이라
   *   익명에겐 존재하지 않는다(excludeBlocked가 viewerId 없을 때 조건을 안 붙이는 것과 같은 결).
   */
  async findPublicProfile(
    id: string,
    viewerId?: string,
  ): Promise<PublicProfile | null> {
    const row = await this.reader.findPublicById(id);
    if (!row) return null;

    return {
      // 요약 3필드(id·nickname·profileImageUrl)의 key → URL 변환은 user가 소유한 단일
      // 소스를 그대로 쓴다 — 여기서 urlResolver를 직접 부르면 그게 인라인 복제의 시작이다.
      ...toUserSummaryView(row, this.urlResolver),
      createdAt: row.createdAt.toISOString(),
      isBlocked: await this.isBlockedBy(viewerId, id),
    };
  }

  /** 뷰어별 플래그 — 쿼리를 낼 필요가 없는 두 경우를 먼저 걷어낸다. */
  private async isBlockedBy(
    viewerId: string | undefined,
    targetId: string,
  ): Promise<boolean> {
    // 익명 뷰어 / 자기 프로필. 후자는 자기 차단이 애초에 불가능하므로(SelfBlockError)
    // DB를 물어봐야 알 수 있는 값이 아니다.
    if (!viewerId || viewerId === targetId) return false;

    return this.blockReader.existsBlock(viewerId, targetId);
  }
}
