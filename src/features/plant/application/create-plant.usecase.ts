import { Injectable } from '@nestjs/common';
import { S3FileStorage } from '../../file/infrastructure/s3-file.storage';
import { Plant } from '../domain/plant';
import { PlantCategory } from '../domain/plant-category';
import { PlantImage } from '../domain/plant-image';
import { PlantImageNotUploadedError } from '../domain/plant.error';
import { PlantWriter } from '../repository/plant.writer';

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
  }): Promise<{ id: string }> {
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

    await this.plantWriter.create(plant);

    // 커맨드 결과는 식별자만 — 응답 표현(조회 DTO)은 컨트롤러가 재조회로 만든다.
    return { id: plant.id };
  }
}
