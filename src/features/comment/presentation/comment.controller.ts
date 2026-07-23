import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiNoContentResponse } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { Authenticated } from '../../auth/presentation/authenticated.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth-user';
import { ApiErrors } from '../../../common/swagger/api-errors.decorator';
import { PostNotFoundError } from '../../post/domain/post.error';
import { CreateReplyUseCase } from '../application/create-reply.usecase';
import { UpdateCommentUseCase } from '../application/update-comment.usecase';
import { DeleteCommentUseCase } from '../application/delete-comment.usecase';
import { CommentQueryService } from '../application/comment-query.service';
import { CommentReader } from '../repository/comment.reader';
import {
  CommentNotFoundError,
  InvalidCommentContentError,
  MentionedUserNotFoundError,
  ReplyDepthExceededError,
} from '../domain/comment.error';
import { CommentDto, CommentIdParamDto } from './dto/comment.dto';
import { CreateReplyDto } from './dto/create-reply.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { CommentPageQueryDto } from './dto/comment-list.dto';
import { ReplyListDto } from './dto/reply-list.dto';

// 개별 댓글 라우트 — 댓글 id는 전역 유니크라 글 경유가 불필요하다(얕은 경로,
// 컬렉션만 부모 밑에 두는 REST 관례). 루트 작성·목록은 PostCommentController.
@Controller('comments')
export class CommentController {
  constructor(
    private readonly createReply: CreateReplyUseCase,
    private readonly updateComment: UpdateCommentUseCase,
    private readonly deleteComment: DeleteCommentUseCase,
    private readonly commentQuery: CommentQueryService,
    private readonly commentReader: CommentReader,
  ) {}

  @Post(':id/replies')
  @Authenticated()
  // PostNotFoundError는 사전 분류와 INSERT 사이 글 삭제 race의 404 — 문서화만 다르고
  // 클라 처리(404)는 CommentNotFoundError와 같다.
  @ApiErrors(
    CommentNotFoundError,
    PostNotFoundError,
    ReplyDepthExceededError,
    InvalidCommentContentError,
    MentionedUserNotFoundError,
  )
  @ZodResponse({
    status: 201,
    description:
      '답글 작성 — :id는 루트 댓글만(답글이면 422 REPLY_DEPTH_EXCEEDED — "답글에 답글"은 ' +
      '같은 루트에 mentionedUserId를 실어 표현). 삭제된 댓글에는 불가(404). 응답 = 단건 조회 표현',
    type: CommentDto,
  })
  async create(
    @Param() params: CommentIdParamDto,
    @Body() dto: CreateReplyDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CommentDto> {
    const { id } = await this.createReply.execute({
      parentId: params.id,
      authorId: user.id,
      content: dto.content,
      mentionedUserId: dto.mentionedUserId,
    });
    // 생성 201 = 조회 표현(재조회) — post 전례.
    const comment = await this.commentQuery.findById(id);
    if (!comment) throw new Error(`created reply not readable: ${id}`);
    return comment;
  }

  // 공개 라우트 = 무표시 — 루트 목록과 동일.
  @Get(':id/replies')
  @ApiErrors(CommentNotFoundError)
  @ZodResponse({
    status: 200,
    description:
      '답글 목록 — 등록순(id ASC) keyset 페이지네이션. :id는 루트 댓글만(답글이면 404). ' +
      '삭제된(deleted: true) 루트의 답글도 열람 가능 — 플레이스홀더가 스레드를 보존한다',
    type: ReplyListDto,
  })
  async list(
    @Param() params: CommentIdParamDto,
    @Query() query: CommentPageQueryDto,
  ): Promise<ReplyListDto> {
    const page = await this.commentQuery.findReplyPage({
      parentId: params.id,
      cursor: query.cursor,
      limit: query.limit,
    });
    // 0행은 "답글 없는 루트"와 "비존재·답글 id"가 겹친다 — 그때만 존재 확인.
    // (답글이 하나라도 나왔다면 부모는 루트임이 구조로 증명된다.)
    if (page.replies.length === 0) {
      const exists = await this.commentReader.rootExists(params.id);
      if (!exists) throw new CommentNotFoundError();
    }
    return page;
  }

  @Patch(':id')
  @Authenticated()
  @ApiErrors(CommentNotFoundError, InvalidCommentContentError)
  @ZodResponse({
    status: 200,
    description:
      '댓글 본문 수정 (구조·멘션은 불변). 타인 댓글·삭제된 댓글은 404(존재 은닉). ' +
      '응답 = 단건 조회 표현',
    type: CommentDto,
  })
  async update(
    @Param() params: CommentIdParamDto,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CommentDto> {
    await this.updateComment.execute({
      id: params.id,
      authorId: user.id,
      content: dto.content,
    });
    // 수정 200 = 조회 표현(재조회) — post 전례.
    const comment = await this.commentQuery.findById(params.id);
    if (!comment) throw new Error(`updated comment not readable: ${params.id}`);
    return comment;
  }

  @Delete(':id')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiErrors(CommentNotFoundError)
  // ZodResponse는 zod DTO가 필수라 본문 없는 204엔 못 쓴다 — swagger 데코 직접 사용.
  @ApiNoContentResponse({
    description:
      '댓글 삭제 — 답글 없는 루트·답글은 완전 삭제, 답글이 남은 루트는 deleted: true ' +
      '플레이스홀더로 전환(본문은 즉시 파기·답글 보존). 마지막 답글이 지워지면 ' +
      '플레이스홀더도 정리된다. 타인 댓글은 404(존재 은닉)',
  })
  async remove(
    @Param() params: CommentIdParamDto,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.deleteComment.execute({ id: params.id, authorId: user.id });
  }
}
