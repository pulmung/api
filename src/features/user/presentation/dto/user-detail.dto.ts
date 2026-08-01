import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { UserSummarySchema } from '../shared/user-summary.schema';

// 파라미터명은 `:userId` — BlockController의 `users/:userId/block`과 같은 리소스를 가리키므로
// 표기를 맞춘다(스펙의 path 파라미터 이름이 codegen 인자명이 된다).
const UserIdParamSchema = z.object({
  userId: z.uuid().meta({ description: '유저 id' }),
});

export class UserIdParamDto extends createZodDto(UserIdParamSchema) {}

/**
 * 남의 프로필(공개 표현) = 작성자 요약 + 가입일 + 뷰어별 플래그.
 *
 * `UserSummarySchema`에서 파생하는 이유: 이 응답은 글·댓글에 실려 나가는 그 요약과 **같은
 * 모양이어야 한다**(같은 유저를 두 화면에서 다르게 그리면 안 된다). 파생해두면 요약에
 * 필드가 늘 때 프로필이 자동으로 따라온다 — PostListItemSchema → PostDetailSchema와 같은 형태.
 *
 * ⚠️ `UserProfileDto`(GET·PATCH /users/me)를 재사용하지 않는다. 그쪽은 provider·email이
 * 함께 나가는 **본인 전용** 표현이라 남에게 주면 이메일이 샌다 — 변경 이유가 다르므로
 * 스키마를 합치지 않는다(§9, user-query.service.ts의 MyProfile doc과 같은 결정).
 *
 * named component(.meta id)는 붙이지 않는다 — 파생 베이스·인라인 전개는 스펙 재사용 단위가
 * 아니다(§9). 붙이면 프론트 codegen 타입 표면이 바뀐다.
 */
const UserDetailSchema = UserSummarySchema.extend({
  createdAt: z.iso.datetime().meta({ description: '가입 시각' }),
  isBlocked: z.boolean().meta({
    description:
      '**내가 이 유저를 차단했는지**. 차단/해제 버튼의 상태용이다. ' +
      '비로그인이면 항상 false. ' +
      '⚠️ 단방향이다 — 상대가 나를 차단했는지는 노출하지 않는다(차단은 상대가 알 수 없어야 ' +
      '조용한 조치가 된다). 차단한 상대의 프로필도 200으로 보인다 — 차단은 목록 필터일 뿐이다',
  }),
});

export class UserDetailDto extends createZodDto(UserDetailSchema) {}
