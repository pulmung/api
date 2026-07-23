import { Injectable } from '@nestjs/common';
import { PublicFileUrlResolver } from '../../file/infrastructure/public-file-url.resolver';
import { PostReader } from '../repository/post.reader';

// 게시글 읽기 모델 — 응답으로 흐르는 경계 → 명시 타입(§5). 내부 행 타입은 reader 추론.
export type PostListItem = {
  id: string;
  title: string;
  excerpt: string;
  // 첫 이미지의 읽기 URL — 이미지 없는 글이면 null(목록 프리뷰는 텍스트만).
  thumbnailUrl: string | null;
  author: { id: string; nickname: string };
  // 식물 태그 요약 — 무관한 글이면 null.
  plant: { id: string; name: string } | null;
  // 살아있는 댓글 수(루트+답글) — posts.commentCount 비정규화 컬럼 그대로.
  commentCount: number;
  createdAt: string;
};
export type PostListPage = {
  posts: PostListItem[];
  nextCursor: string | null;
};
export type PostDetail = PostListItem & {
  // sanitize를 통과해 저장된 HTML — img src에 읽기 URL이 이미 구워져 있어 변환 없음.
  content: string;
  updatedAt: string;
};

// 읽기 조합 레이어(CQRS의 쿼리 핸들러 자리) — reader(DB 행)와 file 어댑터(URL)를
// read model로 빚는다. POST 201·PATCH 200 재조회와 GET :id가 같은 표현을 공유한다.
@Injectable()
export class PostQueryService {
  constructor(
    private readonly reader: PostReader,
    private readonly urlResolver: PublicFileUrlResolver,
  ) {}

  async findPage(params: {
    cursor?: string;
    limit: number;
    plantId?: string;
    authorId?: string;
  }): Promise<PostListPage> {
    // reader는 hasMore 판별용 limit+1행까지 준다(n+1) — 끝 감지에 COUNT 불필요.
    const rows = await this.reader.findPageRows(params);
    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;

    return {
      posts: page.map((row) => this.toListItem(row)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async findById(id: string): Promise<PostDetail | null> {
    const row = await this.reader.findById(id);
    if (!row) return null;

    return {
      ...this.toListItem(row),
      content: row.content,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toListItem(row: {
    id: string;
    title: string;
    excerpt: string;
    thumbnailKey: string | null;
    commentCount: number;
    createdAt: Date;
    author: { id: string; nickname: string };
    plant: { id: string; name: string } | null;
  }): PostListItem {
    return {
      id: row.id,
      title: row.title,
      excerpt: row.excerpt,
      thumbnailUrl: row.thumbnailKey
        ? this.urlResolver.resolve(row.thumbnailKey)
        : null,
      author: row.author,
      plant: row.plant,
      commentCount: row.commentCount,
      // z.iso.datetime()은 Date를 거부한다 — 문자열 직렬화는 여기서.
      createdAt: row.createdAt.toISOString(),
    };
  }
}
