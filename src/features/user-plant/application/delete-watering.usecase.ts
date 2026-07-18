import { Injectable } from '@nestjs/common';
import { WateringNotFoundError } from '../domain/watering.error';
import { WateringWriter } from '../repository/watering.writer';

@Injectable()
export class DeleteWateringUseCase {
  constructor(private readonly wateringWriter: WateringWriter) {}

  async execute(command: {
    wateringId: string;
    userPlantId: string;
    ownerId: string;
  }): Promise<void> {
    const deleted = await this.wateringWriter.delete(command);
    // 비존재·타 개체 소속·타인 소유 수렴(존재 은닉).
    if (!deleted) throw new WateringNotFoundError();
  }
}
