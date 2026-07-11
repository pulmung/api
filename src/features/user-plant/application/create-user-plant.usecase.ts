import { Injectable } from '@nestjs/common';
import { S3FileStorage } from '../../file/infrastructure/s3-file.storage';
import { PlantImage } from '../../plant/domain/plant-image';
import { UserPlant } from '../domain/user-plant';
import { UserPlantImageNotUploadedError } from '../domain/user-plant.error';
import { UserPlantWriter } from '../repository/user-plant.writer';

@Injectable()
export class CreateUserPlantUseCase {
  constructor(
    private readonly storage: S3FileStorage,
    private readonly userPlantWriter: UserPlantWriter,
  ) {}

  async execute(command: {
    ownerId: string;
    name: string;
    images: PlantImage[];
    plantId?: string;
    adoptedAt?: string;
    memo?: string;
  }): Promise<{ id: string }> {
    // 싼 불변식 먼저 — S3 왕복 전에 도메인에서 거른다.
    const userPlant = UserPlant.create(command);

    // 첨부 시점 실존 검증(docs/file-upload.md §1) — presign만 받고 업로드 안 한 key 차단.
    // 빈 배열이면 no-op(분기 불필요). head의 NotFound→null/그 외 throw는 어댑터가 갈라놨다.
    const heads = await Promise.all(
      userPlant.images.map((image) => this.storage.head(image.key)),
    );
    if (heads.some((head) => head === null)) {
      throw new UserPlantImageNotUploadedError();
    }

    // plantId 실존 검증은 writer의 FK 23503 변환이 담당 — 사전 SELECT 없음.
    await this.userPlantWriter.create(userPlant);

    // 커맨드 결과는 식별자만 — 응답 표현(조회 DTO)은 컨트롤러가 재조회로 만든다.
    return { id: userPlant.id };
  }
}
