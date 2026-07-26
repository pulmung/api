import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { Authenticated } from '../../auth/presentation/authenticated.decorator';
import { OptionalAuth } from '../../auth/presentation/optional-auth.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth-user';
import { ApiErrors } from '../../../common/swagger/api-errors.decorator';
import { PostNotFoundError } from '../../post/domain/post.error';
import { CreateCommentUseCase } from '../application/create-comment.usecase';
import { CommentQueryService } from '../application/comment-query.service';
import { CommentReader } from '../repository/comment.reader';
import { InvalidCommentContentError } from '../domain/comment.error';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CommentDto, CommentPostIdParamDto } from './dto/comment.dto';
import { CommentListDto, CommentPageQueryDto } from './dto/comment-list.dto';

// 글의 하위 컬렉션(루트 작성·목록) — 개별 댓글 라우트(comments/:id 계열)와 분리된
// 컨트롤러(watering 전례: 파일 작게, 컬렉션은 부모 밑에·개체는 얕은 경로에).
@Controller('posts/:postId/comments')
export class PostCommentController {
  constructor(
    private readonly createComment: CreateCommentUseCase,
    private readonly commentQuery: CommentQueryService,
    private readonly commentReader: CommentReader,
  ) {}

  @Post()
  @Authenticated()
  @ApiErrors(PostNotFoundError, InvalidCommentContentError)
  @ZodResponse({
    status: 201,
    description:
      '루트 댓글 작성. 답글은 POST /comments/:id/replies. 응답 = 단건 조회 표현(재조회)',
    type: CommentDto,
  })
  async create(
    @Param() params: CommentPostIdParamDto,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CommentDto> {
    const { id } = await this.createComment.execute({
      postId: params.postId,
      authorId: user.id,
      content: dto.content,
    });
    // 생성 201 = 조회 표현(재조회) — 생성/조회 응답의 동일성을 구조로 보장(post 전례).
    const comment = await this.commentQuery.findById(id);
    // 방금 커밋된 행이라 실패는 불변식 위반 — 404가 아니라 500(unexpected)이 정직하다.
    if (!comment) throw new Error(`created comment not readable: ${id}`);
    return comment;
  }

  // 글이 공개면 스레드도 공개다 — 다만 응답이 뷰어별 차단 필터를 받으므로 무표시(공개)가
  // 아니라 @OptionalAuth다. 토큰 없으면 익명 통과(필터 없음), 있으면 검증(잘못됐으면 401).
  // ⚠️ 이 라우트는 원래 공개(데코 0)였다 — 차단 도입으로 계약이 바뀌었다(스펙의 security).
  @Get()
  @OptionalAuth()
  // 뷰어별 응답이라 공유 캐시 금지 — 없으면 A에게 숨겨진 댓글이 B의 응답으로 재사용된다.
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Authorization')
  @ApiErrors(PostNotFoundError)
  @ZodResponse({
    status: 200,
    description:
      '루트 댓글 목록 — 등록순(id ASC) keyset 페이지네이션. 삭제된 댓글은 답글이 남은 ' +
      '경우에만 deleted: true 플레이스홀더로 나온다. 답글은 replyCount만 주고 지연 로드. ' +
      '인증 시 서로 차단한 관계의 댓글이 목록·replyCount에서 제외된다(비로그인이면 전체 노출)',
    type: CommentListDto,
  })
  async list(
    @Param() params: CommentPostIdParamDto,
    @Query() query: CommentPageQueryDto,
    @CurrentUser() user: AuthUser | undefined,
  ): Promise<CommentListDto> {
    const page = await this.commentQuery.findRootPage({
      postId: params.postId,
      cursor: query.cursor,
      limit: query.limit,
      viewerId: user?.id,
    });
    // 페이지 쿼리의 0행은 "댓글 없는 글"과 "비존재 글"이 겹친다 — 그때만 존재 확인
    // (watering 전례).
    if (page.comments.length === 0) {
      const exists = await this.commentReader.postExists(params.postId);
      if (!exists) throw new PostNotFoundError();
    }
    return page;
  }
}
