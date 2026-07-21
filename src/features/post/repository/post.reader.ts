import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../../database/drizzle.constants';
import { plants, posts, users } from '../../../database/schema';

// 게시글 read model의 원천 행 — 부분 select(옵트인). content는 상세 전용이라 목록 제외
// (본문 50k까지 가능 — 목록에 실으면 페이로드가 터진다). authorId 원시 컬럼 대신
// 작성자 요약을 join으로 — 게시판은 공개 자원이라 응답에 작성자 표시가 필수다.
const POST_LIST_ROW = {
  id: posts.id,
  title: posts.title,
  excerpt: posts.excerpt,
  thumbnailKey: posts.thumbnailKey,
  createdAt: posts.createdAt,
  // 작성자 요약 — inner join(author_id notNull + onDelete cascade라 항상 존재).
  author: { id: users.id, nickname: users.nickname },
  // 식물 태그 요약 — left join 미매칭 시 drizzle이 객체째 null로 접는다(user-plant 전례).
  plant: { id: plants.id, name: plants.name },
};

const POST_DETAIL_ROW = {
  ...POST_LIST_ROW,
  content: posts.content,
  updatedAt: posts.updatedAt,
};

// 읽기 어댑터 — 순수 DB 접근. users/plants 직접 join은 모듈 경계 위반이 아니라
// CQRS 읽기의 정상 경로다(read model은 테이블을 횡단한다 — user-plant reader 전례).
@Injectable()
export class PostReader {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // 공개 읽기 — 소유 스코프 없음(게시판). null = 진짜 비존재뿐.
  async findById(id: string) {
    const [row] = await this.db
      .select(POST_DETAIL_ROW)
      .from(posts)
      .innerJoin(users, eq(posts.authorId, users.id))
      .leftJoin(plants, eq(posts.plantId, plants.id))
      .where(eq(posts.id, id));
    return row ?? null;
  }

  // keyset 페이지네이션(uuidv7 id DESC = 최신순) — 전역 목록은 PK btree가,
  // authorId/plantId 필터는 (fk, id) 복합 인덱스가 정렬까지 커버한다.
  // ⚠️ hasMore 판별용으로 limit+1개까지 반환한다(n+1) — 자르기·nextCursor는 호출자 몫.
  async findPageRows(params: {
    cursor?: string;
    limit: number;
    plantId?: string;
    authorId?: string;
  }) {
    return this.db
      .select(POST_LIST_ROW)
      .from(posts)
      .innerJoin(users, eq(posts.authorId, users.id))
      .leftJoin(plants, eq(posts.plantId, plants.id))
      .where(
        and(
          params.authorId ? eq(posts.authorId, params.authorId) : undefined,
          params.plantId ? eq(posts.plantId, params.plantId) : undefined,
          params.cursor ? lt(posts.id, params.cursor) : undefined,
        ),
      )
      .orderBy(desc(posts.id))
      .limit(params.limit + 1);
  }
}
