import { Injectable } from '@nestjs/common';
import { PublicFileUrlResolver } from '../../file/infrastructure/public-file-url.resolver';
import type { PlantCategory } from '../domain/plant-category';
import type { PlantImage } from '../domain/plant-image';
import { PlantReader } from '../repository/plant.reader';

// 카탈로그 읽기 모델 — 응답으로 흐르는 경계 → 명시 타입(§5). 내부 행 타입은 reader 추론.
export type PlantImageView = { url: string; width?: number; height?: number };
export type PlantSummary = {
  id: string;
  name: string;
  coverImage: PlantImageView;
  genus: string | null;
  species: string | null;
  category: PlantCategory | null;
  createdAt: string;
};
export type PlantListPage = {
  plants: PlantSummary[];
  nextCursor: string | null;
};
export type PlantDetail = {
  id: string;
  name: string;
  images: PlantImageView[];
  genus: string | null;
  species: string | null;
  category: PlantCategory | null;
  createdAt: string;
};

// 읽기 조합 레이어(CQRS의 쿼리 핸들러 자리) — reader(DB 행)와 file 어댑터(URL)를
// read model로 빚는다. 조합이 0인 읽기(사전 조회)는 controller → reader 직행으로
// 충분하다(§2) — 이 레이어는 "여러 어댑터 조합·표현 변환"이 있는 읽기에만 둔다.
@Injectable()
export class PlantQueryService {
  constructor(
    private readonly reader: PlantReader,
    private readonly urlResolver: PublicFileUrlResolver,
  ) {}

  async findPage(params: {
    cursor?: string;
    limit: number;
  }): Promise<PlantListPage> {
    // reader는 hasMore 판별용 limit+1행까지 준다(n+1) — 끝 감지에 COUNT 불필요.
    const rows = await this.reader.findPageRows(params);
    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;

    return {
      plants: page.map((row) => ({
        id: row.id,
        name: row.name,
        // images[0] = 대표/커버 — 도메인 불변식(이미지 ≥1)이라 항상 존재.
        coverImage: this.toImageView(row.images[0]),
        genus: row.genus,
        species: row.species,
        category: row.category,
        // z.iso.datetime()은 Date를 거부한다 — 문자열 직렬화는 여기서.
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async findById(id: string): Promise<PlantDetail | null> {
    const row = await this.reader.findById(id);
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      images: row.images.map((image) => this.toImageView(image)),
      genus: row.genus,
      species: row.species,
      category: row.category,
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
