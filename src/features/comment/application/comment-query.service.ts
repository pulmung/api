import { Injectable } from '@nestjs/common';
import { CommentReader } from '../repository/comment.reader';

// 댓글 읽기 모델 — 응답으로 흐르는 경계 → 명시 타입(§5). 내부 행 타입은 reader 추론.
type UserSummary = { id: string; nickname: string };

// 단건 표현(POST 201 × 2 · PATCH 200 공유 — 변경 이유 동일: "댓글을 어떻게 단건
// 표현하나"). replyCount는 목록 컨텍스트의 집계라 단건엔 없다 — 없는 필드를 0으로
// 채우는 거짓말을 하지 않는다.
export type CommentDetail = {
  id: string;
  // null = 루트, 값 = 답글의 루트 id — URL 컨텍스트 없는 단건 응답이 스스로 말한다.
  parentId: string | null;
  content: string;
  author: UserSummary;
  mentionedUser: UserSummary | null;
  createdAt: string;
  updatedAt: string;
};

// 루트 목록 아이템 — deleted로 갈리는 discriminated union. 플레이스홀더에는
// content·author 키 자체가 없다(null 채움 금지 — 계약이 거짓말하지 않는다).
export type RootCommentItem =
  | {
      deleted: false;
      id: string;
      content: string;
      author: UserSummary;
      replyCount: number;
      createdAt: string;
      updatedAt: string;
    }
  | {
      deleted: true;
      id: string;
      replyCount: number;
      createdAt: string;
    };

export type RootCommentPage = {
  comments: RootCommentItem[];
  nextCursor: string | null;
};

// 답글 아이템 — 답글은 soft delete가 없어(writer 삼분기) union이 필요 없다.
// parentId는 URL(:id)이 이미 말하므로 제외.
export type ReplyItem = {
  id: string;
  content: string;
  author: UserSummary;
  mentionedUser: UserSummary | null;
  createdAt: string;
  updatedAt: string;
};

export type ReplyPage = {
  replies: ReplyItem[];
  nextCursor: string | null;
};

// 읽기 조합 레이어(CQRS의 쿼리 핸들러 자리) — reader 행 + replyCount 집계를
// read model로 빚는다. POST 201·PATCH 200 재조회와 목록이 표현을 공유한다.
@Injectable()
export class CommentQueryService {
  constructor(private readonly reader: CommentReader) {}

  async findRootPage(params: {
    postId: string;
    cursor?: string;
    limit: number;
  }): Promise<RootCommentPage> {
    // reader는 hasMore 판별용 limit+1행까지 준다(n+1) — 끝 감지에 COUNT 불필요.
    const rows = await this.reader.findRootPageRows(params);
    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;

    // 페이지의 루트 id들로 답글 수 1쿼리 집계 — 페이지 조립은 reader가 아니라 여기.
    const replyCounts = await this.reader.replyCounts(page.map((r) => r.id));

    return {
      comments: page.map((row) =>
        this.toRootItem(row, replyCounts.get(row.id) ?? 0),
      ),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async findReplyPage(params: {
    parentId: string;
    cursor?: string;
    limit: number;
  }): Promise<ReplyPage> {
    const rows = await this.reader.findReplyPageRows(params);
    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;

    return {
      replies: page.map((row) => ({
        id: row.id,
        content: row.content,
        author: row.author,
        mentionedUser: row.mentionedUser,
        // z.iso.datetime()은 Date를 거부한다 — 문자열 직렬화는 여기서(post 전례).
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async findById(id: string): Promise<CommentDetail | null> {
    const row = await this.reader.findById(id);
    if (!row) return null;

    return {
      id: row.id,
      parentId: row.parentId,
      content: row.content,
      author: row.author,
      mentionedUser: row.mentionedUser,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toRootItem(
    row: {
      id: string;
      content: string | null;
      deletedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      author: UserSummary;
    },
    replyCount: number,
  ): RootCommentItem {
    if (row.deletedAt) {
      // 플레이스홀더 — 본문·작성자를 응답에서 구조적으로 배제(strip이 아니라 미생성).
      return {
        deleted: true,
        id: row.id,
        replyCount,
        createdAt: row.createdAt.toISOString(),
      };
    }
    if (row.content === null) {
      // content NULL ⇔ soft-deleted 불변식 위반 — 빈 문자열로 가리지 않고 500이 정직하다.
      throw new Error(`live comment without content: ${row.id}`);
    }
    return {
      deleted: false,
      id: row.id,
      content: row.content,
      author: row.author,
      replyCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
