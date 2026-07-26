import { Module } from '@nestjs/common';
import { BlockUserUseCase } from './application/block-user.usecase';
import { UnblockUserUseCase } from './application/unblock-user.usecase';
import { BlockQueryService } from './application/block-query.service';
import { CreateReportUseCase } from './application/create-report.usecase';
import { UserBlockWriter } from './repository/user-block.writer';
import { UserBlockReader } from './repository/user-block.reader';
import { ReportWriter } from './repository/report.writer';
import { ReportTargetReader } from './repository/report-target.reader';
import { BlockController } from './presentation/block.controller';
import { ReportController } from './presentation/report.controller';

/**
 * 커뮤니티 안전(moderation) — 차단(유저↔유저 격리)과 신고(운영 접수)를 한 모듈이 소유한다.
 *
 * **왜 UserModule이 아닌가**: 차단은 user의 속성이 아니라 정책이고, 그 정책의 읽기 필터
 * (`repository/block-filter.ts`)를 post·comment가 가져다 쓴다. user가 소유하면 "user가
 * 콘텐츠 가시성을 소유"하는 모양이 된다. 앞으로 자동 숨김·제재·이의제기가 붙을 자리도
 * 여기다("사용 → 소유" §3에서 이 모듈이 소유 쪽).
 *
 * **exports가 없는 이유**: 이 모듈이 밖으로 내보내는 것은 DI 프로바이더가 아니라
 * `excludeBlocked()` — 순수 함수라 파일 import로 끝난다(§9가 zod 조각에 적용한 것과 같은
 * 결: DI가 아닌 계약 조각은 `exports`가 아니라 파일 경계로 공개한다). 소비처는
 * post/comment의 reader이고, 방향은 `post → moderation` 한 방향이다.
 *
 * imports도 없다 — 신고 대상 검증(reports)은 posts·comments·users를 **직접 select**한다
 * (CQRS 읽기의 테이블 횡단은 모듈 경계 위반이 아니다 — post.reader가 users·plants를
 * join하는 것과 같은 경로).
 */
@Module({
  controllers: [BlockController, ReportController],
  providers: [
    BlockUserUseCase,
    UnblockUserUseCase,
    BlockQueryService,
    CreateReportUseCase,
    UserBlockWriter,
    UserBlockReader,
    ReportWriter,
    ReportTargetReader,
  ],
})
export class ModerationModule {}
