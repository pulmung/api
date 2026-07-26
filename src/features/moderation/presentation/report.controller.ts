import { Body, Controller, Post } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { Authenticated } from '../../auth/presentation/authenticated.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth-user';
import { ApiErrors } from '../../../common/swagger/api-errors.decorator';
import { CreateReportUseCase } from '../application/create-report.usecase';
import {
  ReportAlreadyExistsError,
  ReportTargetNotFoundError,
} from '../domain/moderation.error';
import { CreateReportDto, ReportDto } from './dto/create-report.dto';

/**
 * 신고 접수 — **단일 엔드포인트**다(`/posts/:id/reports` 같은 하위 리소스가 아니다).
 *
 * 이유: 신고는 대상의 하위 리소스가 아니라 **운영 큐에 넣는 독립 리소스**다(생성된 뒤
 * 소유자가 신고자에서 운영으로 넘어간다). 대상 종류가 늘 때(커머스 상품·리뷰·채팅) 라우트가
 * 안 늘고, 다형 테이블(targetType + targetId)과 계약이 1:1로 맞는다.
 *
 * PUT이 아니라 POST인 이유(좋아요·차단과 갈리는 지점): 신고는 멱등이 **아니다**. 같은
 * 대상을 다시 신고하면 409이고, 그 구분이 유저에게 의미 있다("이미 신고하셨습니다").
 * 두 번째 요청을 조용히 성공시키면 그 문구를 말할 수 없다.
 *
 * **조회·수정·취소 라우트가 없다** — 의도된 결정이다. 접수된 신고는 신고자의 것이 아니라
 * 운영 자료이고, 취소를 허용하면 "신고했다 취소" 반복이 임계치 판정을 흔든다. 심사 주체
 * (admin)가 생기면 그때 admin 전용 조회가 열린다(report.table.ts doc "미룸").
 */
@Controller('reports')
export class ReportController {
  constructor(private readonly createReport: CreateReportUseCase) {}

  @Post()
  @Authenticated()
  @ApiErrors(ReportTargetNotFoundError, ReportAlreadyExistsError)
  @ZodResponse({
    status: 201,
    description:
      '신고 접수 — 대상이 없거나 이미 삭제됐으면 404, 같은 대상을 이미 신고했으면 409. ' +
      '응답은 접수 확인용 최소 표현이다(조회 라우트가 없어 "201 = 조회 표현" 관례 밖). ' +
      '⚠️ 접수만 한다 — 즉시 콘텐츠가 숨겨지지는 않는다(자동 숨김 임계치 미도입)',
    type: ReportDto,
  })
  async create(
    @Body() dto: CreateReportDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReportDto> {
    const report = await this.createReport.execute({
      reporterId: user.id,
      targetType: dto.targetType,
      targetId: dto.targetId,
      reason: dto.reason,
      detail: dto.detail,
    });
    return {
      id: report.id,
      // z.iso.datetime()은 Date를 거부한다 — 문자열 직렬화는 경계에서(post 전례).
      createdAt: report.createdAt.toISOString(),
    };
  }
}
