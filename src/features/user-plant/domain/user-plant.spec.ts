import { describe, it, expect } from 'vitest';
import {
  UserPlant,
  USER_PLANT_IMAGES_MAX,
  USER_PLANT_NAME_MAX_LENGTH,
} from './user-plant';
import { PlantImage } from '../../plant/domain/plant-image';
import {
  InvalidUserPlantImagesError,
  InvalidUserPlantNameError,
} from './user-plant.error';

const image = (n: number): PlantImage => ({
  key: `user-plant-image/0198c5b2-2f74-7abc-8def-00000000000${n}.jpg`,
  width: 800,
  height: 600,
});
const images = (count: number): PlantImage[] =>
  Array.from({ length: count }, (_, i) => image(i));

describe('UserPlant.create', () => {
  const valid = {
    ownerId: '0198c5b2-2f74-7abc-8def-0123456789ab',
    name: '초록이',
    images: images(2),
    plantId: '0198c5b2-2f74-7abc-8def-0123456789ac',
    adoptedAt: '2026-05-01',
    memo: '거실 창가',
  };

  it('유효한 입력으로 필드를 보존해 UserPlant를 생성한다', () => {
    const userPlant = UserPlant.create(valid);
    expect(userPlant.ownerId).toBe(valid.ownerId);
    expect(userPlant.plantId).toBe(valid.plantId);
    expect(userPlant.name).toBe('초록이');
    expect(userPlant.images).toEqual(valid.images);
    expect(userPlant.adoptedAt).toBe('2026-05-01');
    expect(userPlant.memo).toBe('거실 창가');
  });

  it('id를 자동으로 생성한다 (uuid 형식)', () => {
    expect(UserPlant.create(valid).id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('매 호출마다 다른 id를 생성한다', () => {
    expect(UserPlant.create(valid).id).not.toBe(UserPlant.create(valid).id);
  });

  it('이름 앞뒤 공백을 제거한다', () => {
    expect(UserPlant.create({ ...valid, name: '  초록이  ' }).name).toBe(
      '초록이',
    );
  });

  it('plantId/adoptedAt/memo 미제공 시 null', () => {
    const userPlant = UserPlant.create({
      ownerId: valid.ownerId,
      name: valid.name,
      images: [],
    });
    expect(userPlant.plantId).toBeNull();
    expect(userPlant.adoptedAt).toBeNull();
    expect(userPlant.memo).toBeNull();
  });

  it('memo가 공백뿐이면 null로 정규화한다', () => {
    expect(UserPlant.create({ ...valid, memo: '   ' }).memo).toBeNull();
  });

  it.each([
    ['공백뿐 (trim 후 0자)', '   '],
    [
      `${USER_PLANT_NAME_MAX_LENGTH + 1}자 (최대 초과)`,
      'a'.repeat(USER_PLANT_NAME_MAX_LENGTH + 1),
    ],
  ])('이름이 %s 이면 InvalidUserPlantNameError', (_, name) => {
    expect(() => UserPlant.create({ ...valid, name })).toThrow(
      InvalidUserPlantNameError,
    );
  });

  it.each([
    ['1자 (최소)', 'a'],
    [`${USER_PLANT_NAME_MAX_LENGTH}자 (최대)`, 'a'.repeat(USER_PLANT_NAME_MAX_LENGTH)],
  ])('이름 경계값 %s 은 통과한다', (_, name) => {
    expect(() => UserPlant.create({ ...valid, name })).not.toThrow();
  });

  // 카탈로그(Plant, ≥1)와 달리 빈 배열이 유효하다 — 사진 없는 등록 허용이 의도된 차이.
  it.each([
    ['0장 (빈 배열 허용)', images(0)],
    ['1장', images(1)],
    [`${USER_PLANT_IMAGES_MAX}장 (최대)`, images(USER_PLANT_IMAGES_MAX)],
  ])('이미지 경계값 %s 은 통과한다', (_, imgs) => {
    expect(() => UserPlant.create({ ...valid, images: imgs })).not.toThrow();
  });

  it.each([
    [
      `${USER_PLANT_IMAGES_MAX + 1}장 (최대 초과)`,
      images(USER_PLANT_IMAGES_MAX + 1),
    ],
    // 카탈로그 purpose의 key 재사용이 현실적인 오용 시나리오다.
    ['잘못된 prefix (카탈로그 purpose의 key)', [{ key: 'plant-image/0198.jpg' }]],
    ['중복 key', [image(1), image(1)]],
  ])('이미지가 %s 이면 InvalidUserPlantImagesError', (_, imgs) => {
    expect(() => UserPlant.create({ ...valid, images: imgs })).toThrow(
      InvalidUserPlantImagesError,
    );
  });

  it('width/height 없는 이미지도 허용한다 (선택 힌트)', () => {
    expect(() =>
      UserPlant.create({ ...valid, images: [{ key: 'user-plant-image/x.jpg' }] }),
    ).not.toThrow();
  });
});
