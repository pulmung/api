import { text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { pgTable } from './pg-table';
import { users } from './user.table';
import { reportReasons } from '../../features/moderation/domain/report-reason';
import { reportTargetTypes } from '../../features/moderation/domain/report-target-type';

// 탈퇴 직후 아직 유효한 access token의 INSERT — FK_POST_LIKES_USER와 동일 결(401 변환).
// (set null은 *삭제 전파* 정책일 뿐이라 INSERT 시점의 23503은 그대로 발생한다.)
export const FK_REPORTS_REPORTER = 'fk_reports_reporter';
// 같은 사람이 같은 대상을 두 번 신고 → 23505. 에러가 아니라 멱등 성공으로 처리할지는
// usecase 결정이지만, 판정의 근원은 이 제약이다(§7 — 사전 SELECT 금지).
export const UNIQUE_REPORTS_REPORTER_TARGET = 'uq_reports_reporter_target';

/**
 * 신고 — 유저가 올린 모더레이션 접수 건. 커뮤니티 안전의 입력 채널이다.
 * (차단이 "나 혼자 안 보기"라면 신고는 "운영자가 봐 달라" — 대상·수명·소유가 전부 달라
 * user_blocks와 한 테이블로 합치지 않는다.)
 *
 * ## 왜 다형(targetType + targetId)이고 FK가 없나 — 이 파일의 핵심 결정
 *
 * 대안이었던 exclusive arc(postId·commentId·reportedUserId nullable FK + "정확히 하나"
 * CHECK)는 **FK 무결성이 신고 이력과 정면 충돌**해서 기각했다:
 * - **신고 이력의 수명 > 대상의 수명이다.** "이 유저가 신고를 여러 번 받았다"는 계정
 *   조치의 유일한 근거인데, 신고당한 글이 지워졌다고 이력이 함께 사라지면 상습 위반은
 *   구조적으로 추적 불가능해진다. 신고당하면 곧장 지우는 것이 회피 전략이 된다.
 * - cascade는 이력을 지우고, set null은 대상을 잃는다 — 둘 다 훼손이다. 게다가
 *   set null은 위 CHECK를 UPDATE 시점에 깨뜨려(전부 NULL) **대상 삭제 자체를 실패**시킨다.
 *   즉 exclusive arc + set null + CHECK는 애초에 양립 불가다.
 * - 확장: 신고 가능한 리소스가 늘 때(커머스 상품·리뷰·채팅) 다형은 enum 한 줄이고
 *   arc는 컬럼 + 마이그레이션 + CHECK 갱신이다. admin 큐도 단일 테이블 단일 쿼리로 끝난다.
 *
 * **대가는 정직하게 셋** — 다형을 고른 이상 이건 버그가 아니라 지불하기로 한 값이다:
 * ① 대상 존재 검증을 앱이 한다. 다른 테이블은 INSERT 후 23503을 잡지만(§7 사전 SELECT
 *    금지) 여기엔 잡을 FK가 없으므로, usecase가 대상을 **먼저 조회**한다. 어차피
 *    targetAuthorId를 그 조회로 채워야 하므로 추가 쿼리가 아니다.
 * ② dangling 참조가 정상 상태다. 대상이 지워진 뒤 targetId는 아무것도 안 가리킨다 —
 *    admin 화면이 "삭제된 대상"으로 표시할 수 있어야 한다(조회 실패는 오류가 아니다).
 * ③ 조인이 타입별 분기다. 대상 본문을 붙이려면 admin 쿼리가 targetType으로 갈라진다.
 *
 * ## 무엇을 지금 넣고 무엇을 미뤘나 — 판정 기준은 "소급 가능한가"
 *
 * YAGNI(§0)는 "지금 필요한가"를 묻지만, 그 앞에 **"나중에 넣으면 과거를 복원할 수 있나"**
 * 를 먼저 묻는다. 소급 가능한 것은 미루고, 소급 불가능한 것만 지금 넣는다.
 * - **넣음** — reason·detail·targetAuthorId: 전부 신고 **접수 시점에만** 존재하는 정보다.
 *   특히 targetAuthorId는 대상이 삭제된 뒤엔 어떤 방법으로도 알아낼 수 없다(아래 컬럼 주석).
 * - **미룸** — 처리 상태(resolution·resolvedAt): nullable 컬럼 추가라 완전 additive이고,
 *   그때까지 쌓인 신고가 전부 "미처리"로 나타나는 건 **사실과 정확히 일치**한다. 잃는 게
 *   없으므로 지금 만들지 않는다. → **트리거: 신고를 심사하는 주체(admin API 또는 운영
 *   콘솔)가 실제로 생길 때.** 접수 건수가 늘어나는 것은 트리거가 아니다.
 * - **미룸** — 인덱스(targetType+targetId 집계, targetAuthorId 누적): 인덱스는 소급
 *   적용이라 언제 만들어도 과거 행에 그대로 붙는다. "인덱스는 쿼리가 정한다"
 *   (comment.table.ts 유예 ③) — 그 쿼리들은 admin과 함께 온다. 지금 존재하는 쿼리는
 *   INSERT 중복 판정 하나뿐이고 아래 유니크가 그걸 커버한다.
 * - **기각** — 신고 시점 콘텐츠 스냅샷: 대상이 수정/삭제돼도 심사가 가능해지지만,
 *   §11 최소수집과 충돌하고 무엇보다 **댓글 soft delete가 content를 NULL로 지우는 규율의
 *   우회로**가 된다(유저가 삭제를 요청한 본문이 reports에 사본으로 남는다). 심사는 대상이
 *   살아있는 동안 하고, 지워졌으면 "이미 해소된 신고"로 다룬다. 재검토 트리거: 신고
 *   회피형 즉시 삭제가 실제 패턴으로 관측될 때 — 그때도 스냅샷이 아니라 보존 기한이
 *   붙은 별도 evidence 테이블로 간다.
 * - **없음** — 자동 숨김(신고 N회 임계치), 제재(정지), 이의제기, 신고자 평판: 전부
 *   심사 주체가 생긴 뒤의 이야기다. 지금 넣으면 아무도 읽지 않는 컬럼이 된다.
 *
 * ## 심사 주체 없이 접수만 여는 것이 맞는가 (결정: 맞다)
 *
 * UGC 앱 심사 요건(Apple 1.2)이 요구하는 넷 중 **리뷰어가 실제로 확인하는 것은 앱에서
 * 눌러볼 수 있는 신고·차단 버튼**이다. 뒷단 처리 SLA나 운영 콘솔은 검증할 방법이 없고,
 * 리젝은 "버튼이 없을 때" 난다. 그러므로 접수 라우트(POST /reports) + 차단 라우트가
 * 열리면 요건 쪽은 충족된다.
 *
 * 초기 운영은 SQL 직조회로 한다(admin UI 없음). 그래도 돌아가는 이유: 처리 = "문제
 * 콘텐츠를 기존 삭제 경로로 제거"이고, 그러면 그 신고 행의 targetId가 **dangling이 되어
 * 그 자체로 '해소됨'으로 읽힌다** — 상태 컬럼 없이 처리 여부가 표현된다. 이것이 위
 * "미룸 — 처리 상태"를 지탱하는 근거다. 아쉬워지는 것은 admin UI가 아니라 "신고가 들어온
 * 걸 즉시 아는 것"이며, 그건 docs/todo.md의 알림 축과 함께 온다.
 *
 * 조회·수정·취소 라우트를 유저에게 주지 않는다(report.controller.ts doc) — 접수된 신고는
 * 운영 자료이고, 취소를 허용하면 "신고했다 취소" 반복이 임계치 판정을 흔든다.
 */
export const reports = pgTable(
  'reports',
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    // 신고한 사람. **여기만 FK다** — target 쪽(아래)이 "그때 무엇이었나"라는 이력인 반면
    // 이건 "지금 살아있는 유저의 행위"라서 무결성과 전파가 값을 한다(중복 방지 유니크,
    // "내가 신고한 것" 조회).
    // set null(cascade 아님): 신고자가 탈퇴해도 접수 건은 남아야 한다 — 신고자 사정으로
    // 대상의 위반 이력이 지워지면 안 된다. 신고자만 익명화되고 심사는 계속 가능하다.
    // ⚠️ NULL이 되면 그 행은 중복 방지 유니크에서 빠지지만(NULL끼리는 충돌 안 함),
    // 탈퇴한 유저가 다시 신고할 수는 없으므로 무해하다.
    reporterId: uuid().references(() => users.id, {
      name: FK_REPORTS_REPORTER,
      onDelete: 'set null',
    }),

    // ── 다형 대상 참조 (FK 없음 — 위 doc "왜 다형인가") ──────────────────
    targetType: text({ enum: reportTargetTypes }).notNull(),
    targetId: uuid().notNull(),

    // 신고 시점 대상의 작성자(targetType이 'user'면 targetId와 같다).
    // **소급 불가라 지금 넣는 유일한 컬럼이다** — 대상이 삭제된 뒤엔 "이 신고가 누구를
    // 향했나"를 복원할 방법이 없다. 이 한 컬럼이 "특정 유저에게 신고가 누적됐다"는,
    // 계정 조치의 사실상 유일한 신호를 만든다(대상 개별 건은 지워져도 신호는 남는다).
    // FK 없음: target 쪽 이력은 대상보다 오래 살아야 한다는 위 원칙을 그대로 따른다.
    // 무결성 부담도 낮다 — 클라 입력이 아니라 서버가 대상 조회 중에 읽어 채우는 값이다.
    targetAuthorId: uuid().notNull(),

    reason: text({ enum: reportReasons }).notNull(),

    // 자유 서술(옵셔널, 'other'에선 사실상 필수 — 강제는 Zod 경계가 한다).
    // 신고자가 쓰는 텍스트라 심사 맥락 이상을 담게 두지 않는다(§11 최소수집 — 길이
    // 제약도 경계가 강제. 코드베이스 관례상 DB 길이 제약은 두지 않는다).
    detail: text(),

    // 접수 시각. updatedAt 없음 — 신고는 제출 후 수정되지 않는 불변 행이다
    // (처리 상태가 생기면 그때 resolvedAt이 따로 붙는다. 위 doc "미룸" 참조).
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // (reporter_id, target_type, target_id) — ① 같은 사람의 같은 대상 중복 신고 차단
    // (여러 번 눌러도 신고 1건 = 임계치 판정이 한 사람에게 조작되지 않는다)
    // ② "내가 신고한 것" 조회 ③ users set null 전파 시 대상 행 스캔(reporter_id 선두라
    // leftmost prefix로 커버 — comment.mentionedUserId가 인덱스 없이 seq scan이 된
    // 유예 ③을 여기서는 처음부터 피한다).
    unique(UNIQUE_REPORTS_REPORTER_TARGET).on(
      t.reporterId,
      t.targetType,
      t.targetId,
    ),
  ],
);

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
