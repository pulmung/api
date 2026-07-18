import { Module } from '@nestjs/common';
import { FileModule } from '../file/file.module';
import { CreateUserPlantUseCase } from './application/create-user-plant.usecase';
import { UpdateUserPlantUseCase } from './application/update-user-plant.usecase';
import { DeleteUserPlantUseCase } from './application/delete-user-plant.usecase';
import { RecordWateringUseCase } from './application/record-watering.usecase';
import { DeleteWateringUseCase } from './application/delete-watering.usecase';
import { UserPlantQueryService } from './application/user-plant-query.service';
import { UserPlantWriter } from './repository/user-plant.writer';
import { UserPlantReader } from './repository/user-plant.reader';
import { WateringWriter } from './repository/watering.writer';
import { WateringReader } from './repository/watering.reader';
import { UserPlantController } from './presentation/user-plant.controller';
import { WateringController } from './presentation/watering.controller';

@Module({
  // S3FileStorage(head 실존 검증) + PublicFileUrlResolver(읽기 URL) seam
  // ("사용 → 소유" 한 방향: user-plant → file). plant 의존은 모듈이 아니라
  // DB 레벨(FK·읽기 join)에만 있다 — PlantModule import 불필요.
  imports: [FileModule],
  controllers: [UserPlantController, WateringController],
  providers: [
    CreateUserPlantUseCase,
    UpdateUserPlantUseCase,
    DeleteUserPlantUseCase,
    RecordWateringUseCase,
    DeleteWateringUseCase,
    UserPlantQueryService,
    UserPlantWriter,
    UserPlantReader,
    WateringWriter,
    WateringReader,
  ],
})
export class UserPlantModule {}
