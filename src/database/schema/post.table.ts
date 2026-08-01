import {
  uuid,
  text,
  timestamp,
  index,
  integer,
  jsonb,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { pgTable } from './pg-table';
import { users } from './user.table';
import { plants } from './plant.table';

// 무상태 access token은 계정 삭제를 즉시 모른다(폐기는 refresh 경계 책임 — architecture §10).
// 삭제된 유저의 아직 유효한 토큰으로 INSERT가 오면 23503 — 사전 SELECT 대신 이 이름으로
// 잡아 도메인 예외로 변환한다(waterings의 FK와 같은 결, §7 원칙의 FK 버전).
export const FK_POSTS_AUTHOR = 'fk_posts_author';
// 유저가 보낸 plantId는 신뢰 불가 — 존재하지 않는(방금 삭제된) id면 INSERT가 23503.
// 사전 SELECT 대신 이 이름으로 잡아 도메인 예외로 변환한다(FK_USER_PLANTS_PLANT와 동일 경로).
export const FK_POSTS_PLANT = 'fk_posts_plant';

/**
 * 게시글 — 커뮤니티 축(글/댓글·읽기 중심·SEO)의 루트. 제목 + HTML 본문(서식·이미지
 * 인라인) 게시판 모델이다.
 *
 * 본문 포맷 = HTML (블록 JSON 대신 — 의도된 결정):
 * 게시판형이라 본문 렌더는 상세 화면 한정(목록은 아래 파생 필드만 사용)이고, 서식
 * 요구(볼드·삭선·글자색)가 확정되며 앱 네이티브 에디터의 이점이 사라져(서식 편집은
 * 어차피 WebView) 완제품 에디터(웹 WYSIWYG)를 그대로 쓰는 쪽을 택했다. 대가로 서버가
 * 지불하는 규율 4가지 — ① 저장 전 sanitize(allowlist) 필수 ② 파생 필드(excerpt·
 * thumbnailKey·imageKeys)를 쓰기 시점에 추출 ③ img src에 URL이 구워지므로 우리 소유
 * 고정 이미지 도메인으로만 서빙(불투명 key 규약의 명시적 예외 — 이 이미지들은 signed
 * URL 전환 불가, 공개 게시판이라 수용) ④ 글자색은 inline style이 아니라 닫힌 팔레트
 * class(sanitize가 style 속성 제거 — 다크모드 보호).
 *
 * 목록 정렬·커서는 createdAt이 아니라 id 단일 기준: PK가 uuidv7(시간순)이라
 * `WHERE id < cursor ORDER BY id DESC`가 PK btree를 그대로 타고, 유니크라 tie-break
 * 복합 커서가 필요 없다. (id는 앱 생성·createdAt은 DB 시각이라 밀리초 단위로 어긋날
 * 수 있지만, 기준을 id 하나로 통일하는 한 무해하다.)
 *
 * 의도적으로 없는 것 — 전부 도입 시점에 additive:
 * - 카테고리(게시판 구분): 요구가 생기면 닫힌 enum으로(§9 배포 트레인 기준).
 *
 * 재검토가 끝난 것(각 도메인 도입 시점 결정 — comment.table.ts·post-like.table.ts doc 참조):
 * - 댓글 카운터: commentCount로 비정규화(아래 컬럼).
 * - 좋아요 카운터: likeCount로 비정규화(아래 컬럼) — 목록 표시가 확정 수요라 commentCount와
 *   동일 계산. 라이브 COUNT는 목록 페이지마다 N회 집계라 비정규화의 관리 비용이 더 싸다.
 * - 글 soft delete: 계속 하드 삭제. 스레드 보존은 댓글 자체의 soft delete가 맡고,
 *   글 삭제 = 스레드 전체 소멸(comments cascade)이 게시판 관례와 일치한다.
 */
export const posts = pgTable(
  'posts',
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    // 탈퇴 = 글도 소멸(cascade) — 그 글의 댓글·좋아요도 함께 사라진다.
    //
    // **왜 comments.authorId(set null, 보존)와 갈리나** — 두 테이블의 *기존* 삭제 정책을
    // 각자 그대로 따른 결과다. 위 doc이 이미 결정했듯 **글 삭제 = 스레드 전체 소멸**이
    // 게시판 관례다(유저가 자기 글을 직접 지우면 남의 댓글도 통째로 사라진다). 그렇다면
    // "글 100개를 하나씩 지우고 탈퇴"와 "그냥 탈퇴"의 결과가 달라질 이유가 없다.
    // 반면 댓글 삭제는 삼분기라 "답글이 있으면 자리를 지킨다"가 그 테이블의 규율이고,
    // 그래서 댓글만 set null로 남는다. 즉 이 비대칭은 절충이 아니라 **일관성**이다.
    // (2026-07 재검토: 한때 이 컬럼도 set null이었다. "타인의 대화 맥락 보존"을 근거로
    //  들었으나, 그 원칙은 글 레벨에서 이 레포가 이미 포기한 것이라 탈퇴에만 되살릴
    //  근거가 없었다. 되돌리면서 아래 셋을 함께 얻었다: 수정·삭제 불가한 유령 글이
    //  안 생긴다 · 이미지 참조가 끊겨 sweep GC가 청소한다(프라이버시) · 읽기 경로가
    //  inner join으로 남아 응답 계약이 단순하다.)
    //
    // 트레이드오프로 포기한 것: 정보성 글의 축적 자산·SEO(탈퇴로 사라진다). 유저가 직접
    // 지워도 어차피 사라지므로 탈퇴자의 글만 붙잡아둘 근거가 되지 못한다고 판단했다.
    // **재검토 트리거**: 지식 축적이 서비스의 핵심 자산이 되어 "탈퇴해도 본문은 남긴다"가
    // 약관·정책으로 요구될 때(Stack Overflow의 CC 라이선스 모델).
    //
    // 끊긴 이미지 참조는 월간 sweep GC가 청소한다(docs/todo.md — 별도 enqueue 불필요).
    authorId: uuid()
      .notNull()
      .references(() => users.id, {
        name: FK_POSTS_AUTHOR,
        onDelete: 'cascade',
      }),

    // 카탈로그 종 태그 — "이 글이 다루는 식물". 질문/탐색의 주제 축: 종 맥락 제공,
    // "이 식물의 글" 목록, 식물 상세의 관련 글 섹션. 옵셔널 — 특정 식물에 관한 글이
    // 아닌 것(장비·흙 질문, 자유글)은 정상 상태다.
    // set null: 카탈로그 행이 정리되면 글은 태그만 잃는다(user_plants.plantId와 동일
    // 논리 — restrict면 그 행을 참조하는 글 때문에 admin이 쓰레기 엔트리를 못 지운다).
    // 내 개체(user_plants) 태그 = 성장일지는 SNS/일지 축 기능이라 계속 미룸(additive).
    plantId: uuid().references(() => plants.id, {
      name: FK_POSTS_PLANT,
      onDelete: 'set null',
    }),

    // 길이 제약은 DB가 아니라 경계(Zod)가 강제 — 코드베이스 관례(user_plants.name과 동일).
    title: text().notNull(),

    // sanitize를 통과한 HTML만 저장한다 — 클라 원문을 그대로 넣는 경로를 만들지 말 것
    // (stored XSS). 정화·파싱은 쓰기 유스케이스의 책임이고, 조회는 이 컬럼을 신뢰한다.
    content: text().notNull(),

    // ── 파생 필드(비정규화) ─────────────────────────────────────────────
    // 원본은 content 하나. 아래 셋은 쓰기 시점에 서버가 sanitize 파스 트리에서 함께
    // 추출한다(수정 시 재추출) → 조회·GC가 HTML을 다시 파싱할 일이 없다.
    // 목록 프리뷰용 플레인텍스트 발췌(이미지 없는 글이면 빈 문자열 가능).
    excerpt: text().notNull(),
    // 목록 썸네일 = 첫 이미지의 storage key. 이미지 없는 글이면 null.
    thumbnailKey: text(),
    // 본문이 참조하는 모든 이미지 key — sweep GC 참조 스캔의 구조화된 인덱스.
    // ⚠️ GC 스캔 대상에 posts.imageKeys를 추가할 것(todo.md 규율 (b), 현재 목록:
    //    user_plants·plants).
    imageKeys: jsonb().$type<string[]>().notNull(),

    // 살아있는(soft-deleted 제외) 댓글 수(루트+답글) — 목록 표시용 비정규화.
    // 증감은 comment.writer.ts가 댓글 쓰기와 같은 트랜잭션에서 수행하며, 그때
    // updatedAt 자기대입으로 $onUpdate를 억제한다(댓글 활동 ≠ 글 수정).
    commentCount: integer().notNull().default(0),

    // 좋아요 수 — 목록 표시용 비정규화(commentCount와 같은 결). 증감은 좋아요 쓰기
    // 어댑터가 post_likes INSERT/DELETE와 같은 트랜잭션에서 수행하며, 그때 updatedAt
    // 자기대입으로 $onUpdate를 억제한다(좋아요 활동 ≠ 글 수정). post-like.table.ts doc 참조.
    // 계정 삭제 경로도 같은 규율을 따른다 — post_likes cascade에 맡기면 어댑터를 우회해
    // 드리프트하므로, DeleteUserUseCase가 좋아요를 명시적으로 지우며 여기를 일괄 감소시킨다.
    likeCount: integer().notNull().default(0),

    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // (author_id, id) 복합 하나가 ① "이 유저의 글 목록" 커서 조회(WHERE author_id = ?
    // AND id < ? ORDER BY id DESC — 정렬까지 인덱스가 커버) ② users cascade 삭제 시
    // 자식 행 스캔(leftmost prefix)을 겸한다(waterings 복합 유니크와 같은 결).
    // 전역 목록은 PK가 커버하므로 별도 인덱스 없음.
    index('idx_posts_author').on(t.authorId, t.id),
    // "이 식물의 글" 커서 목록(WHERE plant_id = ? AND id < ? ORDER BY id DESC)과
    // plants 삭제 시 set null 전파 스캔을 하나로 커버(idx_posts_author와 같은 구성).
    index('idx_posts_plant').on(t.plantId, t.id),
  ],
);

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
