import { Injectable } from '@nestjs/common';
import { PublicFileUrlResolver } from '../../file/infrastructure/public-file-url.resolver';
import type { PlantImage } from '../../plant/domain/plant-image';
import type { PlantImageView } from '../../plant/application/plant-query.service';
import { UserPlantReader } from '../repository/user-plant.reader';

// 내 식물 읽기 모델 — 응답으로 흐르는 경계 → 명시 타입(§5). 내부 행 타입은 reader 추론.
export type UserPlantDetail = {
  id: string;
  name: string;
  images: PlantImageView[];
  // 연결된 카탈로그 요약 — 미동정(plantId null)이면 null. 개체 name(애칭)과
  // 카탈로그 name(종명)의 키 충돌은 중첩으로 푼다.
  plant: { id: string; name: string } | null;
  adoptedAt: string | null; // 'YYYY-MM-DD' (date 컬럼 string 모드 — 변환 없음)
  memo: string | null;
  createdAt: string;
};

// 읽기 조합 레이어(CQRS의 쿼리 핸들러 자리) — reader(DB 행)와 file 어댑터(URL)를
// read model로 빚는다. 지금은 POST 201 재조회 전용이며, 추후 GET /user-plants/:id가
// 같은 표현을 공유한다(생성/조회 이원화 차단).
@Injectable()
export class UserPlantQueryService {
  constructor(
    private readonly reader: UserPlantReader,
    private readonly urlResolver: PublicFileUrlResolver,
  ) {}

  async findById(id: string): Promise<UserPlantDetail | null> {
    const row = await this.reader.findById(id);
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      images: row.images.map((image) => this.toImageView(image)),
      plant: row.plant,
      adoptedAt: row.adoptedAt,
      memo: row.memo,
      // z.iso.datetime()은 Date를 거부한다 — 문자열 직렬화는 여기서.
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toImageView(image: PlantImage): PlantImageView {
    return {
      url: this.urlResolver.resolve(image.key),
      width: image.width,
      height: image.height,
    };
  }
}
