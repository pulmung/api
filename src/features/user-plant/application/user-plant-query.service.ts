import { Injectable } from '@nestjs/common';
import { PublicFileUrlResolver } from '../../file/infrastructure/public-file-url.resolver';
import type { PlantImage } from '../../plant/domain/plant-image';
import type { PlantImageView } from '../../plant/application/plant-query.service';
import { nextWateringOn } from '../domain/watering-schedule';
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
  wateringIntervalDays: number | null;
  lastWateredOn: string | null;
  // 파생값(lastWateredOn + interval) — 규칙은 domain(watering-schedule)이 소유,
  // 여기선 조합만. 서버가 한 번 계산해 web·mobile의 중복 구현을 없앤다.
  nextWateringOn: string | null;
  createdAt: string;
};

export type UserPlantListItem = {
  id: string;
  name: string;
  // 내 사진[0] → (없으면) 카탈로그 대표 → null. 목록 응답엔 카탈로그 이미지가 따로
  // 없어 클라가 폴백할 수 없다 — 그래서 서버가 여기서 접는다.
  coverImage: PlantImageView | null;
  plant: { id: string; name: string } | null;
  adoptedAt: string | null;
  wateringIntervalDays: number | null;
  lastWateredOn: string | null;
  nextWateringOn: string | null;
  createdAt: string;
};
export type UserPlantListPage = {
  userPlants: UserPlantListItem[];
  nextCursor: string | null;
};

// 읽기 조합 레이어(CQRS의 쿼리 핸들러 자리) — reader(DB 행)와 file 어댑터(URL)를
// read model로 빚는다. POST 201 재조회와 GET /user-plants/:id가 같은 표현을
// 공유한다(생성/조회 이원화 차단).
@Injectable()
export class UserPlantQueryService {
  constructor(
    private readonly reader: UserPlantReader,
    private readonly urlResolver: PublicFileUrlResolver,
  ) {}

  async findPage(params: {
    ownerId: string;
    cursor?: string;
    limit: number;
  }): Promise<UserPlantListPage> {
    // reader는 hasMore 판별용 limit+1행까지 준다(n+1) — 끝 감지에 COUNT 불필요.
    const rows = await this.reader.findPageRows(params);
    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;

    return {
      userPlants: page.map((row) => {
        const cover = row.images[0] ?? row.plant?.images[0];
        return {
          id: row.id,
          name: row.name,
          coverImage: cover ? this.toImageView(cover) : null,
          plant: row.plant ? { id: row.plant.id, name: row.plant.name } : null,
          adoptedAt: row.adoptedAt,
          wateringIntervalDays: row.wateringIntervalDays,
          lastWateredOn: row.lastWateredOn,
          nextWateringOn: nextWateringOn(
            row.lastWateredOn,
            row.wateringIntervalDays,
          ),
          createdAt: row.createdAt.toISOString(),
        };
      }),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async findById(id: string, ownerId: string): Promise<UserPlantDetail | null> {
    const row = await this.reader.findById(id, ownerId);
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      images: row.images.map((image) => this.toImageView(image)),
      plant: row.plant,
      adoptedAt: row.adoptedAt,
      memo: row.memo,
      wateringIntervalDays: row.wateringIntervalDays,
      lastWateredOn: row.lastWateredOn,
      nextWateringOn: nextWateringOn(
        row.lastWateredOn,
        row.wateringIntervalDays,
      ),
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
