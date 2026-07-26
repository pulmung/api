import { Injectable } from '@nestjs/common';
import { DatabaseError } from 'pg';
import { DrizzleQueryError } from 'drizzle-orm';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { DrizzleDB } from '../../../database/drizzle.constants';
import type { DrizzleTransactionalAdapter } from '../../../database/drizzle-transactional.adapter';
import { PG_ERROR_CODE } from '../../../database/postgres-error';
import {
  reports,
  FK_REPORTS_REPORTER,
  UNIQUE_REPORTS_REPORTER_TARGET,
} from '../../../database/schema';
import { UnauthenticatedError } from '../../auth/domain/auth.error';
import { ReportAlreadyExistsError } from '../domain/moderation.error';
import type { ReportReason } from '../domain/report-reason';
import type { ReportTargetType } from '../domain/report-target-type';

/**
 * 신고 쓰기 어댑터 — `reports` 한 테이블만 소유한다.
 *
 * 중복 판정은 앱이 아니라 DB가 한다(uq_reports_reporter_target) — 사전 SELECT("이미
 * 신고했나?")를 두면 검사와 쓰기 사이에 경합이 생기고, 더블탭이 정확히 그 경합이다(§7).
 * 대상 실존 검증만은 사전 SELECT인데, 그건 FK가 없어서 어쩔 수 없다(ReportTargetReader doc).
 */
@Injectable()
export class ReportWriter {
  constructor(
    private readonly txHost: TransactionHost<DrizzleTransactionalAdapter>,
  ) {}

  // 진행 중인 트랜잭션이 있으면 그 핸들을, 없으면 평범한 db를 준다(CLS가 고른다).
  private get db(): DrizzleDB {
    return this.txHost.tx;
  }

  // 반환은 접수 확인용 최소 표현 — 신고는 유저가 다시 조회할 리소스가 아니다(controller doc).
  async insert(report: {
    reporterId: string;
    targetType: ReportTargetType;
    targetId: string;
    targetAuthorId: string;
    reason: ReportReason;
    detail?: string;
  }): Promise<{ id: string; createdAt: Date }> {
    try {
      const [row] = await this.db
        .insert(reports)
        .values(report)
        .returning({ id: reports.id, createdAt: reports.createdAt });
      return row;
    } catch (e) {
      this.throwIfConstraintViolation(e);
      throw e;
    }
  }

  // 제약 위반을 도메인 예외로 변환 — drizzle v1.0은 원본 pg 에러를 `.cause`에 감싼다(§7).
  private throwIfConstraintViolation(e: unknown): void {
    const cause = e instanceof DrizzleQueryError ? e.cause : e;
    if (!(cause instanceof DatabaseError)) return;

    // 같은 사람이 같은 대상을 이미 신고 — 409(멱등 성공으로 삼키지 않는다, 에러 doc 참조).
    if (
      cause.code === PG_ERROR_CODE.UNIQUE_VIOLATION &&
      cause.constraint === UNIQUE_REPORTS_REPORTER_TARGET
    ) {
      throw new ReportAlreadyExistsError();
    }
    // 탈퇴 직후 아직 만료 안 된 access token의 INSERT(무상태 검증이라 즉시 모름 — §10) — 401.
    // ⚠️ targetId·targetAuthorId엔 FK가 없으므로 여기로 오지 않는다 — 대상 검증은
    //    사전 조회가 이미 마쳤다(ReportTargetReader).
    if (
      cause.code === PG_ERROR_CODE.FOREIGN_KEY_VIOLATION &&
      cause.constraint === FK_REPORTS_REPORTER
    ) {
      throw new UnauthenticatedError();
    }
  }
}
