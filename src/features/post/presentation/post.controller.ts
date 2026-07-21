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
import { CreatePostUseCase } from '../application/create-post.usecase';
import { UpdatePostUseCase } from '../application/update-post.usecase';
import { DeletePostUseCase } from '../application/delete-post.usecase';
import { PostQueryService } from '../application/post-query.service';
import {
  InvalidPostContentError,
  InvalidPostImageSrcError,
  InvalidPostTitleError,
  PostImageNotUploadedError,
  PostNotFoundError,
  ReferencedPlantNotFoundError,
} from '../domain/post.error';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostDetailDto, PostIdParamDto } from './dto/post-detail.dto';
import { PostListDto, PostListQueryDto } from './dto/post-list.dto';

@Controller('posts')
export class PostController {
  constructor(
    private readonly createPost: CreatePostUseCase,
    private readonly updatePost: UpdatePostUseCase,
    private readonly deletePost: DeletePostUseCase,
    private readonly postQuery: PostQueryService,
  ) {}

  @Post()
  @Authenticated()
  @ApiErrors(
    InvalidPostTitleError,
    InvalidPostContentError,
    InvalidPostImageSrcError,
    PostImageNotUploadedError,
    ReferencedPlantNotFoundError,
  )
  @ZodResponse({
    status: 201,
    description:
      '게시글 작성 — 본문 HTML은 서버 sanitize를 거쳐 저장된다. 응답 = GET /posts/:id와 같은 조회 표현',
    type: PostDetailDto,
  })
  async create(
    @Body() dto: CreatePostDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PostDetailDto> {
    const { id } = await this.createPost.execute({
      authorId: user.id,
      title: dto.title,
      content: dto.content,
      plantId: dto.plantId,
    });

    // 생성 201 = 조회 표현(재조회) — 생성/조회 응답의 동일성을 구조로 보장(REST 관례).
    const post = await this.postQuery.findById(id);
    // 방금 커밋된 행이라 실패는 불변식 위반 — 404가 아니라 500(unexpected)이 정직하다.
    if (!post) throw new Error(`created post not readable: ${id}`);
    return post;
  }

  // 공개 라우트 = 무표시(데코 0) — 게시판은 비로그인 열람 가능(읽기 중심·SEO).
  @Get()
  @ZodResponse({
    status: 200,
    description:
      '게시글 목록 — 최신순(id DESC) keyset 페이지네이션. plantId/authorId 필터 조합 가능',
    type: PostListDto,
  })
  async list(@Query() query: PostListQueryDto): Promise<PostListDto> {
    return this.postQuery.findPage({
      cursor: query.cursor,
      limit: query.limit,
      plantId: query.plantId,
      authorId: query.authorId,
    });
  }

  @Get(':id')
  @ApiErrors(PostNotFoundError)
  @ZodResponse({
    status: 200,
    description: '게시글 상세 — 공개(비로그인 열람 가능)',
    type: PostDetailDto,
  })
  async detail(@Param() params: PostIdParamDto): Promise<PostDetailDto> {
    const post = await this.postQuery.findById(params.id);
    if (!post) throw new PostNotFoundError();
    return post;
  }

  @Patch(':id')
  @Authenticated()
  @ApiErrors(
    PostNotFoundError,
    InvalidPostTitleError,
    InvalidPostContentError,
    InvalidPostImageSrcError,
    PostImageNotUploadedError,
    ReferencedPlantNotFoundError,
  )
  @ZodResponse({
    status: 200,
    description:
      '게시글 부분 수정 (JSON Merge Patch: 필드 부재 = 미변경, plantId null = 태그 해제). ' +
      'content 제공 시 재정화 + 파생(발췌·썸네일) 재계산. 타인 글은 404(존재 은닉). 응답 = 조회 표현',
    type: PostDetailDto,
  })
  async update(
    @Param() params: PostIdParamDto,
    @Body() dto: UpdatePostDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PostDetailDto> {
    await this.updatePost.execute({
      id: params.id,
      authorId: user.id,
      title: dto.title,
      content: dto.content,
      plantId: dto.plantId,
    });

    // 수정 200 = 조회 표현(재조회) — POST 201과 동일 패턴.
    const post = await this.postQuery.findById(params.id);
    // 방금 수정한 행이라 실패는 불변식 위반 — 404가 아니라 500(unexpected)이 정직하다.
    if (!post) throw new Error(`updated post not readable: ${params.id}`);
    return post;
  }

  @Delete(':id')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiErrors(PostNotFoundError)
  // ZodResponse는 zod DTO가 필수라 본문 없는 204엔 못 쓴다 — swagger 데코 직접 사용.
  @ApiNoContentResponse({
    description:
      '게시글 삭제 (hard delete) — S3 이미지 객체는 지우지 않는다(sweep GC 몫, docs/todo.md). 타인 글은 404(존재 은닉)',
  })
  async remove(
    @Param() params: PostIdParamDto,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.deletePost.execute({ id: params.id, authorId: user.id });
  }
}
