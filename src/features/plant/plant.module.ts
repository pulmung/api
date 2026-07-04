import { Module } from '@nestjs/common';
import { FileModule } from '../file/file.module';
import { CreatePlantUseCase } from './application/create-plant.usecase';
import { PlantWriter } from './repository/plant.writer';
import { PlantController } from './presentation/plant.controller';

@Module({
  // S3FileStorage seam — 첨부 시점 head() 실존 검증 ("사용 → 소유" 한 방향: plant → file)
  imports: [FileModule],
  controllers: [PlantController],
  providers: [CreatePlantUseCase, PlantWriter],
})
export class PlantModule {}
