import { Module } from '@nestjs/common';
import { FileModule } from '../file/file.module';
import { CreateUserPlantUseCase } from './application/create-user-plant.usecase';
import { UserPlantQueryService } from './application/user-plant-query.service';
import { UserPlantWriter } from './repository/user-plant.writer';
import { UserPlantReader } from './repository/user-plant.reader';
import { UserPlantController } from './presentation/user-plant.controller';

@Module({
  // S3FileStorage(head 실존 검증) + PublicFileUrlResolver(읽기 URL) seam
  // ("사용 → 소유" 한 방향: user-plant → file). plant 의존은 모듈이 아니라
  // DB 레벨(FK·읽기 join)에만 있다 — PlantModule import 불필요.
  imports: [FileModule],
  controllers: [UserPlantController],
  providers: [
    CreateUserPlantUseCase,
    UserPlantQueryService,
    UserPlantWriter,
    UserPlantReader,
  ],
})
export class UserPlantModule {}
