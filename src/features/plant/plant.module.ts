import { Module } from '@nestjs/common';
import { FileModule } from '../file/file.module';
import { CreatePlantUseCase } from './application/create-plant.usecase';
import { PlantWriter } from './repository/plant.writer';
import { PlantDictionaryReader } from './repository/plant-dictionary.reader';
import { PlantController } from './presentation/plant.controller';
import { GeneraController } from './presentation/genera.controller';
import { SpeciesController } from './presentation/species.controller';

@Module({
  // S3FileStorage seam — 첨부 시점 head() 실존 검증 ("사용 → 소유" 한 방향: plant → file)
  imports: [FileModule],
  controllers: [PlantController, GeneraController, SpeciesController],
  providers: [CreatePlantUseCase, PlantWriter, PlantDictionaryReader],
})
export class PlantModule {}
