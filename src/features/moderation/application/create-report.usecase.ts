import { Injectable } from '@nestjs/common';
import { ReportTargetReader } from '../repository/report-target.reader';
import { ReportWriter } from '../repository/report.writer';
import { ReportTargetNotFoundError } from '../domain/moderation.error';
import type { ReportReason } from '../domain/report-reason';
import type { ReportTargetType } from '../domain/report-target-type';

/**
 * 신고 접수 — 운영 큐에 한 건을 넣는다. 심사·조치는 이 유스케이스의 책임이 아니다
 * (admin 주체가 생길 때까지 처리 상태 컬럼조차 두지 않는다 — report.table.ts doc).
 *
 * 두 단계다: ① 대상 실존 확인 + 작성자 수집 ② INSERT.
 * `@Transactional()`을 붙이지 않는다 — 두 단계 사이에 대상이 삭제돼도 신고는 남아야
 * 정확하기 때문이다(신고 이력의 수명 > 대상의 수명, report.table.ts doc). 즉 "함께
 * 성공하거나 함께 실패한다"가 여기선 **틀린** 진술이다(§7-1: 경계는 그 진술이 참일 때만).
 * 두 문장을 원자적으로 묶어봐야 targetAuthorId가 조금 더 신선해질 뿐인데, 그 값의 용도는
 * "접수 시점에 누구를 향했나"라는 이력이라 그 신선함이 필요하지 않다.
 *
 * **자기 콘텐츠 신고를 막지 않는다** — SelfBlockError와 의도적으로 갈린다. 자기 차단은
 * 의미가 모순이고 실제 피해가 있다(자기 글이 자기 목록에서 사라진다). 자기 신고는 무해해서
 * admin이 기각하면 끝이고, 애초에 클라가 버튼을 안 보여주면 발생하지 않는다. 막으려면
 * 에러 코드(=계약)가 하나 늘어나는데 그 값이 없다(§0).
 */
@Injectable()
export class CreateReportUseCase {
  constructor(
    private readonly targetReader: ReportTargetReader,
    private readonly writer: ReportWriter,
  ) {}

  async execute(command: {
    reporterId: string;
    targetType: ReportTargetType;
    targetId: string;
    reason: ReportReason;
    detail?: string;
  }): Promise<{ id: string; createdAt: Date }> {
    // FK가 없어 23503을 잡을 수 없으므로 사전 조회다 — 다만 targetAuthorId를 어차피
    // 여기서 얻어야 하니 추가 쿼리가 아니다(ReportTargetReader doc).
    const target = await this.targetReader.findTargetMeta(
      command.targetType,
      command.targetId,
    );
    // 대상 자체가 없을 때만 404다. 대상은 있는데 작성자가 탈퇴한 경우(target.authorId ===
    // null)는 접수한다 — 콘텐츠가 남아 있는 이상 신고 경로가 막히면 안 된다(report.table.ts).
    if (!target) throw new ReportTargetNotFoundError();

    return this.writer.insert({ ...command, targetAuthorId: target.authorId });
  }
}
