import { Injectable } from '@nestjs/common';
import { UserPlantNotFoundError } from '../domain/user-plant.error';
import { WateringReader } from '../repository/watering.reader';
import { WateringWriter } from '../repository/watering.writer';

@Injectable()
export class RecordWateringUseCase {
  constructor(
    private readonly wateringWriter: WateringWriter,
    private readonly wateringReader: WateringReader,
  ) {}

  async execute(command: {
    ownerId: string;
    userPlantId: string;
    wateredOn: string;
  }): Promise<{ id: string }> {
    // 소유 스코프 INSERT...SELECT — 행복 경로는 1쿼리.
    const insertedId = await this.wateringWriter.insertIfOwned(command);
    if (insertedId !== null) return { id: insertedId };

    // 0행 = "부모 비존재/타인 소유" vs "같은 날 기록 존재(유니크 충돌)" — 재조회로 해소.
    // 기존 행이 있으면 그 id로 동일 201(멱등 — 더블탭 안전, 클라 분기 0).
    const existing = await this.wateringReader.findByPlantAndDate(command);
    if (existing) return { id: existing.id };
    // 비존재·타인 소유 수렴(존재 은닉) — user-plant 라우트들과 동일한 404.
    throw new UserPlantNotFoundError();
  }
}
