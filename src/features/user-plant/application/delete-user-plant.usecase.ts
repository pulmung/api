import { Injectable } from '@nestjs/common';
import { UserPlantNotFoundError } from '../domain/user-plant.error';
import { UserPlantWriter } from '../repository/user-plant.writer';

@Injectable()
export class DeleteUserPlantUseCase {
  constructor(private readonly userPlantWriter: UserPlantWriter) {}

  async execute(command: { id: string; ownerId: string }): Promise<void> {
    const deleted = await this.userPlantWriter.delete(
      command.id,
      command.ownerId,
    );
    // 비존재·타인 소유 수렴(존재 은닉) — GET :id와 동일한 404.
    if (!deleted) throw new UserPlantNotFoundError();
  }
}
