import { Injectable } from '@nestjs/common';
import { S3FileStorage } from '../../file/infrastructure/s3-file.storage';
import { Plant } from '../domain/plant';
import { PlantCategory } from '../domain/plant-category';
import { PlantImage } from '../domain/plant-image';
import { PlantImageNotUploadedError } from '../domain/plant.error';
import { PlantWriter } from '../repository/plant.writer';

// 경계(응답으로 흐름) → 명시 타입(§5).
export type CreatedPlant = {
  id: string;
  name: string;
  images: PlantImage[];
  genus: string | null;
  species: string | null;
  category: PlantCategory | null;
  createdAt: string;
};

@Injectable()
export class CreatePlantUseCase {
  constructor(
    private readonly storage: S3FileStorage,
    private readonly plantWriter: PlantWriter,
  ) {}

  async execute(command: {
    name: string;
    images: PlantImage[];
    genus?: string;
    species?: string;
    category?: PlantCategory;
    createdById: string;
  }): Promise<CreatedPlant> {
    // 싼 불변식 먼저 — S3 왕복 전에 도메인에서 거른다.
    const plant = Plant.create(command);

    // 첨부 시점 실존 검증(docs/file-upload.md §1) — presign만 받고 업로드 안 한 key 차단.
    // head는 NotFound→null, 권한 오류 등은 throw(→500)로 어댑터가 이미 갈라놨다.
    const heads = await Promise.all(
      plant.images.map((image) => this.storage.head(image.key)),
    );
    if (heads.some((head) => head === null)) {
      throw new PlantImageNotUploadedError();
    }

    const { createdAt } = await this.plantWriter.create(plant);

    return {
      id: plant.id,
      name: plant.name,
      images: plant.images,
      genus: plant.genus,
      species: plant.species,
      category: plant.category,
      // Date 그대로 반환하면 응답 직렬화(z.iso.datetime)가 거부한다 → ISO 문자열로.
      createdAt: createdAt.toISOString(),
    };
  }
}
