import { describe, it, expect } from 'vitest';
import {
  UserPlant,
  UserPlantPatch,
  USER_PLANT_IMAGES_MAX,
  USER_PLANT_NAME_MAX_LENGTH,
  WATERING_INTERVAL_MAX_DAYS,
  WATERING_INTERVAL_MIN_DAYS,
} from './user-plant';
import { PlantImage } from '../../plant/domain/plant-image';
import {
  InvalidUserPlantImagesError,
  InvalidUserPlantNameError,
  InvalidWateringIntervalError,
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

  it('wateringIntervalDays 미제공 시 null (물주기 관리 안 함)', () => {
    expect(UserPlant.create(valid).wateringIntervalDays).toBeNull();
  });

  it.each([
    [`${WATERING_INTERVAL_MIN_DAYS}일 (최소)`, WATERING_INTERVAL_MIN_DAYS],
    [`${WATERING_INTERVAL_MAX_DAYS}일 (최대)`, WATERING_INTERVAL_MAX_DAYS],
  ])('물주기 간격 경계값 %s 은 통과한다', (_, days) => {
    expect(
      UserPlant.create({ ...valid, wateringIntervalDays: days })
        .wateringIntervalDays,
    ).toBe(days);
  });

  it.each([
    [`${WATERING_INTERVAL_MIN_DAYS - 1} (최소 미만)`, WATERING_INTERVAL_MIN_DAYS - 1],
    [`${WATERING_INTERVAL_MAX_DAYS + 1} (최대 초과)`, WATERING_INTERVAL_MAX_DAYS + 1],
    ['1.5 (비정수)', 1.5],
  ])('물주기 간격이 %s 이면 InvalidWateringIntervalError', (_, days) => {
    expect(() =>
      UserPlant.create({ ...valid, wateringIntervalDays: days }),
    ).toThrow(InvalidWateringIntervalError);
  });
});

describe('UserPlantPatch.create', () => {
  it('전체 패치 시 필드를 보존한다 (name trim, memo trim)', () => {
    const patch = UserPlantPatch.create({
      name: '  새이름  ',
      plantId: '0198c5b2-2f74-7abc-8def-0123456789ac',
      images: images(2),
      adoptedAt: '2026-05-01',
      memo: '  베란다로 이사  ',
    });
    expect(patch.name).toBe('새이름');
    expect(patch.plantId).toBe('0198c5b2-2f74-7abc-8def-0123456789ac');
    expect(patch.images).toEqual(images(2));
    expect(patch.adoptedAt).toBe('2026-05-01');
    expect(patch.memo).toBe('베란다로 이사');
  });

  // merge-patch의 핵심: 부재(undefined)는 그대로 통과해야 "미변경"이 된다.
  // create의 `?? null`/`|| null` 정규화를 복붙하면 부재가 해제(null)로 강제되는 회귀 가드.
  it('전 필드 부재 시 전부 undefined로 남는다 (null로 강제되지 않는다)', () => {
    const patch = UserPlantPatch.create({});
    expect(patch.name).toBeUndefined();
    expect(patch.plantId).toBeUndefined();
    expect(patch.images).toBeUndefined();
    expect(patch.adoptedAt).toBeUndefined();
    expect(patch.memo).toBeUndefined();
    expect(patch.wateringIntervalDays).toBeUndefined();
  });

  it('null 명시(plantId/adoptedAt/memo/wateringIntervalDays)는 null로 남는다 (해제)', () => {
    const patch = UserPlantPatch.create({
      plantId: null,
      adoptedAt: null,
      memo: null,
      wateringIntervalDays: null,
    });
    expect(patch.plantId).toBeNull();
    expect(patch.adoptedAt).toBeNull();
    expect(patch.memo).toBeNull();
    expect(patch.wateringIntervalDays).toBeNull();
  });

  it('memo가 공백뿐이면 null로 정규화한다 (create와 동일)', () => {
    expect(UserPlantPatch.create({ memo: '   ' }).memo).toBeNull();
  });

  it('빈 이미지 배열은 유효하다 (전체 제거)', () => {
    expect(UserPlantPatch.create({ images: [] }).images).toEqual([]);
  });

  // 제공된 필드는 UserPlant.create와 같은 불변식을 통과해야 한다(검증 공유).
  it.each([
    ['공백뿐 (trim 후 0자)', '   '],
    [
      `${USER_PLANT_NAME_MAX_LENGTH + 1}자 (최대 초과)`,
      'a'.repeat(USER_PLANT_NAME_MAX_LENGTH + 1),
    ],
  ])('이름이 %s 이면 InvalidUserPlantNameError', (_, name) => {
    expect(() => UserPlantPatch.create({ name })).toThrow(
      InvalidUserPlantNameError,
    );
  });

  it.each([
    ['1자 (최소)', 'a'],
    [`${USER_PLANT_NAME_MAX_LENGTH}자 (최대)`, 'a'.repeat(USER_PLANT_NAME_MAX_LENGTH)],
  ])('이름 경계값 %s 은 통과한다', (_, name) => {
    expect(() => UserPlantPatch.create({ name })).not.toThrow();
  });

  it.each([
    [
      `${USER_PLANT_IMAGES_MAX + 1}장 (최대 초과)`,
      images(USER_PLANT_IMAGES_MAX + 1),
    ],
    ['잘못된 prefix (카탈로그 purpose의 key)', [{ key: 'plant-image/0198.jpg' }]],
    ['중복 key', [image(1), image(1)]],
  ])('이미지가 %s 이면 InvalidUserPlantImagesError', (_, imgs) => {
    expect(() => UserPlantPatch.create({ images: imgs })).toThrow(
      InvalidUserPlantImagesError,
    );
  });

  // 제공된 간격은 create와 같은 범위 불변식을 통과해야 한다(검증 공유).
  it.each([
    [`${WATERING_INTERVAL_MIN_DAYS - 1} (최소 미만)`, WATERING_INTERVAL_MIN_DAYS - 1],
    [`${WATERING_INTERVAL_MAX_DAYS + 1} (최대 초과)`, WATERING_INTERVAL_MAX_DAYS + 1],
    ['1.5 (비정수)', 1.5],
  ])('물주기 간격이 %s 이면 InvalidWateringIntervalError', (_, days) => {
    expect(() =>
      UserPlantPatch.create({ wateringIntervalDays: days }),
    ).toThrow(InvalidWateringIntervalError);
  });
});
