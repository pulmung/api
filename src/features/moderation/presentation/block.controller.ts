import { Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { Authenticated } from '../../auth/presentation/authenticated.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth-user';
import { ApiErrors } from '../../../common/swagger/api-errors.decorator';
import { BlockUserUseCase } from '../application/block-user.usecase';
import { UnblockUserUseCase } from '../application/unblock-user.usecase';
import { BlockQueryService } from '../application/block-query.service';
import {
  BlockTargetNotFoundError,
  SelfBlockError,
} from '../domain/moderation.error';
import { BlockDto, BlockParamDto } from './dto/block.dto';
import { BlockListDto, BlockListQueryDto } from './dto/block-list.dto';

/**
 * 차단 — "이 상대에 대한 내 차단"이라는 **싱글턴 하위 리소스**다(주체는 토큰이 정한다).
 *
 * PUT/DELETE인 이유는 PostLikeController의 논거를 그대로 승계한다: 연산이 완전 멱등인데
 * POST는 명세상 비멱등이라 정직한 클라이언트가 타임아웃 시 재시도하지 않는다. 주 클라가
 * 모바일(RN)이라 그 손실이 실질적이다. 첫 차단에도 201을 주지 않는다 — 상태에 따라 응답이
 * 갈리면 "완전 멱등 = 클라 분기 0"이 깨진다.
 *
 * 경로가 `users/`로 시작하지만 모듈은 UserModule이 아니라 ModerationModule이다
 * (watering이 `user-plants/:id/waterings`에 살면서 UserPlantModule에 속한 전례). 차단은
 * user의 속성이 아니라 **커뮤니티 안전 정책**이고, 그 정책의 읽기 필터(block-filter)를
 * post·comment가 가져다 쓴다 — 소유자가 user면 "user가 콘텐츠 가시성을 소유"하는
 * 이상한 모양이 된다.
 *
 * 차단의 **효과 범위**(합의된 결정): 목록에서 숨김만 한다. 상세 URL 직접 접근은 그대로
 * 보여주고, 이미 달린 댓글·좋아요도 정리하지 않는다. 공개 게시판이라 로그아웃으로 우회
 * 가능하므로 이건 보안 경계가 아니라 UX 필터다 — 우회 가능한 것을 막느라 복잡도를 쓰지
 * 않는다(user-block.table.ts doc 참조).
 */
@Controller('users')
export class BlockController {
  constructor(
    private readonly blockUser: BlockUserUseCase,
    private readonly unblockUser: UnblockUserUseCase,
    private readonly blockQuery: BlockQueryService,
  ) {}

  // ⚠️ `:userId/block`보다 **먼저** 선언한다 — 지금은 메서드가 갈려(GET vs PUT/DELETE)
  // 충돌하지 않지만, `GET :userId/block`이 생기면 순서가 유일한 방어선이 된다.
  @Get('me/blocks')
  @Authenticated()
  // 응답이 뷰어 자신의 데이터라 공유 캐시 금지(post 목록의 뷰어별 응답과 같은 이유).
  @ZodResponse({
    status: 200,
    description:
      '내가 차단한 유저 목록 — 해제 UI용. keyset 페이지네이션(user.id 오름차순). ' +
      '"나를 차단한 유저"는 노출하지 않는다 — 차단은 상대가 알 수 없어야 조용한 조치가 된다',
    type: BlockListDto,
  })
  async list(
    @Query() query: BlockListQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<BlockListDto> {
    return this.blockQuery.findPage({
      blockerId: user.id,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Put(':userId/block')
  @Authenticated()
  @ApiErrors(SelfBlockError, BlockTargetNotFoundError)
  @ZodResponse({
    status: 200,
    description:
      '차단 — 이미 차단한 상대에 다시 보내도 동일 200(멱등). 자기 자신은 422, 없는 유저는 404. ' +
      '효과는 양방향이다: 차단 후 서로의 글·댓글이 목록에서 사라진다(상세 직접 접근은 유지)',
    type: BlockDto,
  })
  async block(
    @Param() params: BlockParamDto,
    @CurrentUser() user: AuthUser,
  ): Promise<BlockDto> {
    await this.blockUser.execute({
      blockerId: user.id,
      blockedId: params.userId,
    });
    return { blocked: true };
  }

  @Delete(':userId/block')
  @Authenticated()
  @ZodResponse({
    status: 200,
    description:
      '차단 해제 — 차단하지 않은 상대에 보내도 동일 200(멱등). ' +
      '자기 자신·없는 유저도 200이다(PUT과 달리 422/404가 없다 — 목표 상태에 이미 도달해 있다)',
    type: BlockDto,
  })
  async unblock(
    @Param() params: BlockParamDto,
    @CurrentUser() user: AuthUser,
  ): Promise<BlockDto> {
    await this.unblockUser.execute({
      blockerId: user.id,
      blockedId: params.userId,
    });
    return { blocked: false };
  }
}
