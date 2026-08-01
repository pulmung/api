import { Injectable } from '@nestjs/common';
import { PublicFileUrlResolver } from '../../file/infrastructure/public-file-url.resolver';
import type { SocialProvider } from '../domain/social-provider';
import { UserReader } from '../repository/user.reader';

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
}
