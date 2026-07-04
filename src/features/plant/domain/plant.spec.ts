import { describe, it, expect } from 'vitest';
import { Plant, PLANT_IMAGES_MAX, PLANT_NAME_MAX_LENGTH } from './plant';
import { PlantImage } from './plant-image';
import { InvalidPlantImagesError, InvalidPlantNameError } from './plant.error';

const image = (n: number): PlantImage => ({
  key: `plant-image/0198c5b2-2f74-7abc-8def-00000000000${n}.jpg`,
  width: 800,
  height: 600,
});
const images = (count: number): PlantImage[] =>
  Array.from({ length: count }, (_, i) => image(i));

describe('Plant.create', () => {
  const valid = {
    name: '몬스테라 알보',
    images: images(2),
    genus: 'Monstera',
    species: 'deliciosa',
    category: '관엽' as const,
    createdById: '0198c5b2-2f74-7abc-8def-0123456789ab',
  };

  it('유효한 입력으로 필드를 보존해 Plant를 생성한다', () => {
    const plant = Plant.create(valid);
    expect(plant.name).toBe('몬스테라 알보');
    expect(plant.images).toEqual(valid.images);
    expect(plant.genus).toBe('Monstera');
    expect(plant.species).toBe('deliciosa');
    expect(plant.category).toBe('관엽');
    expect(plant.createdById).toBe(valid.createdById);
  });

  it('id를 자동으로 생성한다 (uuid 형식)', () => {
    expect(Plant.create(valid).id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('매 호출마다 다른 id를 생성한다', () => {
    expect(Plant.create(valid).id).not.toBe(Plant.create(valid).id);
  });

  it('이름 앞뒤 공백을 제거한다', () => {
    expect(Plant.create({ ...valid, name: '  몬스테라  ' }).name).toBe(
      '몬스테라',
    );
  });

  it('genus/species/category 미제공 시 null', () => {
    const plant = Plant.create({
      name: valid.name,
      images: valid.images,
      createdById: valid.createdById,
    });
    expect(plant.genus).toBeNull();
    expect(plant.species).toBeNull();
    expect(plant.category).toBeNull();
  });

  it('genus/species가 공백뿐이면 null로 정규화한다', () => {
    const plant = Plant.create({ ...valid, genus: '   ', species: '  ' });
    expect(plant.genus).toBeNull();
    expect(plant.species).toBeNull();
  });

  it.each([
    ['공백뿐 (trim 후 0자)', '   '],
    [`${PLANT_NAME_MAX_LENGTH + 1}자 (최대 초과)`, 'a'.repeat(PLANT_NAME_MAX_LENGTH + 1)],
  ])('이름이 %s 이면 InvalidPlantNameError', (_, name) => {
    expect(() => Plant.create({ ...valid, name })).toThrow(
      InvalidPlantNameError,
    );
  });

  it.each([
    ['1자 (최소)', 'a'],
    [`${PLANT_NAME_MAX_LENGTH}자 (최대)`, 'a'.repeat(PLANT_NAME_MAX_LENGTH)],
  ])('이름 경계값 %s 은 통과한다', (_, name) => {
    expect(() => Plant.create({ ...valid, name })).not.toThrow();
  });

  it.each([
    ['0장', images(0)],
    [`${PLANT_IMAGES_MAX + 1}장 (최대 초과)`, images(PLANT_IMAGES_MAX + 1)],
    ['잘못된 prefix (다른 purpose의 key)', [{ key: 'chat-file/0198.jpg' }]],
    ['중복 key', [image(1), image(1)]],
  ])('이미지가 %s 이면 InvalidPlantImagesError', (_, imgs) => {
    expect(() => Plant.create({ ...valid, images: imgs })).toThrow(
      InvalidPlantImagesError,
    );
  });

  it.each([
    ['1장 (최소)', images(1)],
    [`${PLANT_IMAGES_MAX}장 (최대)`, images(PLANT_IMAGES_MAX)],
  ])('이미지 경계값 %s 은 통과한다', (_, imgs) => {
    expect(() => Plant.create({ ...valid, images: imgs })).not.toThrow();
  });

  it('width/height 없는 이미지도 허용한다 (선택 힌트)', () => {
    expect(() =>
      Plant.create({ ...valid, images: [{ key: 'plant-image/x.jpg' }] }),
    ).not.toThrow();
  });
});
