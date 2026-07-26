import { Controller, Delete, Param, Put } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { Authenticated } from '../../auth/presentation/authenticated.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth-user';
import { ApiErrors } from '../../../common/swagger/api-errors.decorator';
import { LikePostUseCase } from '../application/like-post.usecase';
import { UnlikePostUseCase } from '../application/unlike-post.usecase';
import { PostNotFoundError } from '../domain/post.error';
import { PostLikeDto, PostLikeParamDto } from './dto/post-like.dto';

/**
 * 좋아요 — "이 글에 대한 내 좋아요"라는 **싱글턴 하위 리소스**다(유저는 토큰이 정한다).
 *
 * POST가 아니라 PUT인 이유(레포의 POST 관례에서 의도적으로 벗어남): 이 연산은 완전 멱등인데
 * POST는 명세상 비멱등이라, 정직한 HTTP 클라이언트·프록시는 타임아웃 시 POST를 재시도하지
 * 않는다 — 멱등하게 만들어놓고 그 사실을 아무도 쓸 수 없게 된다. 주 클라가 네트워크 불안정한
 * 모바일(RN)이라 이 손실이 실질적이다. PUT/DELETE는 멱등성이 **메서드 자체로** 전달되고,
 * 경로도 동사("좋아요 해라")가 아니라 명사("내 좋아요")로 읽힌다. 같은 모양의 성숙한 선례로
 * GitHub의 `PUT/DELETE /user/starred/{owner}/{repo}`가 있다.
 * (`POST /user-plants/:id/waterings`와 모순 아님 — 그건 행이 시간축으로 쌓이는 진짜 컬렉션
 * append이고 멱등성은 부수적이다. 여기선 (post,user)당 1행이고 멱등성이 본질이다.)
 *
 * 첫 좋아요에 201을 주지 않는다(RFC 9110 §9.3.4의 "생성 시 201" 의도적 미준수): 상태에 따라
 * 응답이 갈리면 "완전 멱등 = 클라 분기 0"이 깨진다. GitHub의 star도 같은 이유로 항상 동일
 * 상태코드를 준다.
 */
@Controller('posts/:postId/like')
export class PostLikeController {
  constructor(
    private readonly likePost: LikePostUseCase,
    private readonly unlikePost: UnlikePostUseCase,
  ) {}

  @Put()
  @Authenticated()
  @ApiErrors(PostNotFoundError)
  @ZodResponse({
    status: 200,
    description:
      '좋아요 — 이미 좋아요한 글에 다시 보내도 동일 200(멱등, 카운터 불변 — 더블탭·재시도 안전). ' +
      '비존재 글은 404. 응답의 likeCount는 요청 반영 후의 권위값',
    type: PostLikeDto,
  })
  async like(
    @Param() params: PostLikeParamDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PostLikeDto> {
    const likeCount = await this.likePost.execute({
      postId: params.postId,
      userId: user.id,
    });
    return { isLiked: true, likeCount };
  }

  @Delete()
  @Authenticated()
  @ApiErrors(PostNotFoundError)
  @ZodResponse({
    status: 200,
    description:
      '좋아요 취소 — 좋아요하지 않은 글에 보내도 동일 200(멱등, 카운터 불변). 비존재 글은 404. ' +
      '204가 아닌 이유: 갱신된 likeCount를 실어 낙관적 UI가 경합으로 틀렸을 때 즉시 복구시킨다',
    type: PostLikeDto,
  })
  async unlike(
    @Param() params: PostLikeParamDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PostLikeDto> {
    const likeCount = await this.unlikePost.execute({
      postId: params.postId,
      userId: user.id,
    });
    return { isLiked: false, likeCount };
  }
}
