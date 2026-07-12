import { Injectable } from '@nestjs/common';
import { S3FileStorage } from '../../file/infrastructure/s3-file.storage';
import { PlantImage } from '../../plant/domain/plant-image';
import { UserPlantPatch } from '../domain/user-plant';
import {
  UserPlantImageNotUploadedError,
  UserPlantNotFoundError,
} from '../domain/user-plant.error';
import { UserPlantWriter } from '../repository/user-plant.writer';

@Injectable()
export class UpdateUserPlantUseCase {
  constructor(
    private readonly storage: S3FileStorage,
    private readonly userPlantWriter: UserPlantWriter,
  ) {}

  async execute(command: {
    id: string;
    ownerId: string;
    name?: string;
    plantId?: string | null;
    images?: PlantImage[];
    adoptedAt?: string | null;
    memo?: string | null;
  }): Promise<void> {
    // 싼 불변식 먼저 — S3 왕복 전에 도메인에서 거른다(create와 동일 순서).
    const patch = UserPlantPatch.create(command);

    // images가 제공된 경우에만 head 실존 검증 — 제공된 key 전부(기존 대비 diff 없이 단순).
    // 미제공이면 저장된 key를 재검증하지 않는다(등록/직전 수정 시점에 이미 검증됨).
    // 이 422가 존재 확인(아래 update)보다 먼저 발화하지만, 존재 여부와 무관한 에러라
    // 누출이 없다 — DTO 400이 404보다 먼저인 것과 같은 결.
    if (patch.images !== undefined) {
      const heads = await Promise.all(
        patch.images.map((image) => this.storage.head(image.key)),
      );
      if (heads.some((head) => head === null)) {
        throw new UserPlantImageNotUploadedError();
      }
    }

    const updated = await this.userPlantWriter.update(
      command.id,
      command.ownerId,
      patch,
    );
    // 비존재·타인 소유 수렴(존재 은닉) — GET :id와 동일한 404.
    if (!updated) throw new UserPlantNotFoundError();
    // 커맨드라 반환 없음 — 응답 표현(조회 DTO)은 컨트롤러가 재조회로 만든다.
  }
}
