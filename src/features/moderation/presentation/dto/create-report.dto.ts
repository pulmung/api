import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { reportReasons } from '../../domain/report-reason';
import { reportTargetTypes } from '../../domain/report-target-type';

// 두 enum 모두 `.meta({ id })`를 붙이지 않는다 — 지금 이 DTO 하나만 쓴다. named
// component는 "여러 DTO가 공유할 때"의 도구이고(§9), 미리 붙이면 스펙에 $ref로
// 호이스팅돼 프론트 codegen 타입 표면만 바뀐다. 신고 조회·admin DTO가 생겨 같은 enum을
// 두 번째로 쓰게 되면 그때 shared/로 올려 id를 부여한다.
const CreateReportSchema = z.object({
  targetType: z.enum(reportTargetTypes).meta({
    description:
      "신고 대상 종류. 'user'는 콘텐츠가 아니라 계정 자체(프로필·닉네임·반복 행위)",
  }),
  targetId: z.uuid().meta({
    description:
      '대상 id — targetType에 해당하는 리소스. 없거나 삭제됐으면 404',
  }),
  reason: z.enum(reportReasons).meta({
    description:
      '신고 사유(닫힌 집합). 표시 문구는 클라가 소유한다 — 값은 안정적 식별자다. ' +
      "'illegal'은 멸종위기종(CITES) 거래·불법 채집을 포함한다",
  }),
  // 최소수집(§11) — 심사 맥락을 적기에 충분하고 서술 이상을 담기엔 부족한 상한.
  // 길이 제약은 DB가 아니라 이 경계가 강제한다(코드베이스 관례).
  detail: z.string().trim().min(1).max(1000).optional().meta({
    description:
      "자유 서술(선택). reason이 'other'면 사실상 필수 — 없으면 심사가 불가능하다",
    example: '같은 내용을 여러 글에 반복 게시하고 있습니다',
  }),
});

export class CreateReportDto extends createZodDto(CreateReportSchema) {}

// 접수 확인용 최소 표현 — 신고는 유저가 다시 조회할 리소스가 아니므로 "생성 201 = 조회
// 표현"(§9) 관례가 적용되지 않는다(그 관례는 조회 라우트가 존재할 때의 것).
const ReportSchema = z.object({
  id: z.uuid().meta({
    description:
      '접수 번호 — 문의 시 참조용. 조회 API는 없다(admin 전용 데이터)',
  }),
  createdAt: z.iso.datetime().meta({ description: '접수 시각' }),
});

export class ReportDto extends createZodDto(ReportSchema) {}
