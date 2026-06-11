/**
 * 인기 식물 "속(genus)" 시드 사전 — 셀렉트박스 자동완성용 통제 어휘.
 *
 * 왜 이 파일이 손큐레이션인가:
 *   - 공식 분류 DB(국립수목원)엔 속 tier 자체가 없고, Wikidata엔 있지만
 *     인기 관엽일수록 한글 라벨이 비어있다(알로카시아·싱고니움·디펜바키아 등).
 *   - 인기 관엽/다육의 한글명은 "유통명/속칭"이라 공식 DB의 사각지대다.
 *   - 그래서 그 사각지대(=가장 자주 쓰는 것들)만 유통명으로 직접 채운다.
 *
 * 성격:
 *   - 이건 "속이 콘텐츠를 소유하는 엔티티"가 아니라 입력 보조용 lookup 사전이다.
 *   - plant 행은 여기서 고르거나(셀렉트) 직접입력한 값을 문자열로 저장한다(FK 아님).
 *   - 롱테일은 UGC 직접입력으로 자라며, ko가 비는 속은 라틴으로 표시된다.
 *
 * 주의(검수 포인트):
 *   - ko는 유통명 기준(예: Monstera → "몬스테라", 속 접미사 생략 — 유저 검색어에 맞춤).
 *   - 일부는 학계 재분류가 있으나 유통명을 유지한다(아래 note 참고).
 *   - 니치 항목은 서비스 색깔에 맞게 잘라내거나 더해라. 이건 초안이다.
 */

export const PLANT_CATEGORIES = [
  '관엽식물',
  '다육식물',
  '선인장',
  '괴근식물',
  '난초',
  '허브',
  '식충식물',
  '수생식물',
] as const;

export type PlantCategory = (typeof PLANT_CATEGORIES)[number];

export type GenusSeed = {
  /** 유통명(표시·검색용 기본 한글) */
  ko: string;
  /** 라틴 속명(학명 골격) */
  latin: string;
  /** 유저 관점 카테고리(genus 선택 시 plant.category 자동제안 용도) */
  category: PlantCategory;
  /** 다른 표기/별칭(검색 매칭 보강) */
  aliases?: string[];
  /** 분류/명칭 주의 메모(검수용, 런타임엔 불필요) */
  note?: string;
};

export const GENUS_SEED: GenusSeed[] = [
  // ── 관엽식물 ────────────────────────────────────────────────
  { ko: '몬스테라', latin: 'Monstera', category: '관엽식물' },
  { ko: '필로덴드론', latin: 'Philodendron', category: '관엽식물' },
  { ko: '안스리움', latin: 'Anthurium', category: '관엽식물', aliases: ['안투리움'] },
  { ko: '알로카시아', latin: 'Alocasia', category: '관엽식물' },
  { ko: '콜로카시아', latin: 'Colocasia', category: '관엽식물', aliases: ['토란'] },
  { ko: '칼라디움', latin: 'Caladium', category: '관엽식물' },
  { ko: '싱고니움', latin: 'Syngonium', category: '관엽식물' },
  { ko: '스파티필룸', latin: 'Spathiphyllum', category: '관엽식물' },
  { ko: '디펜바키아', latin: 'Dieffenbachia', category: '관엽식물' },
  { ko: '아글라오네마', latin: 'Aglaonema', category: '관엽식물' },
  { ko: '자미오쿨카스', latin: 'Zamioculcas', category: '관엽식물', aliases: ['ZZ플랜트', '금전수'] },
  { ko: '스킨답서스', latin: 'Epipremnum', category: '관엽식물', aliases: ['포토스', '에피프렘넘'], note: 'Epipremnum aureum 유통명. Scindapsus와 통칭 혼용됨' },
  { ko: '스킨답서스픽투스', latin: 'Scindapsus', category: '관엽식물', aliases: ['실버스킨답서스'], note: 'Scindapsus pictus. 위 Epipremnum과 구분' },
  { ko: '칼라데아', latin: 'Calathea', category: '관엽식물', note: '상당수가 Goeppertia로 재분류됨(유통명 칼라데아 유지)' },
  { ko: '마란타', latin: 'Maranta', category: '관엽식물' },
  { ko: '스트로만테', latin: 'Stromanthe', category: '관엽식물' },
  { ko: '크테난테', latin: 'Ctenanthe', category: '관엽식물' },
  { ko: '고무나무', latin: 'Ficus', category: '관엽식물', aliases: ['피쿠스', '떡갈고무나무', '벵갈고무나무'] },
  { ko: '드라세나', latin: 'Dracaena', category: '관엽식물', aliases: ['행운목'] },
  { ko: '산세베리아', latin: 'Sansevieria', category: '관엽식물', aliases: ['산세비에리아', '스투키'], note: '현재 Dracaena로 통합되었으나 유통명 산세베리아 유지' },
  { ko: '호야', latin: 'Hoya', category: '관엽식물' },
  { ko: '페페로미아', latin: 'Peperomia', category: '관엽식물' },
  { ko: '필레아', latin: 'Pilea', category: '관엽식물', aliases: ['펜케이크식물'] },
  { ko: '베고니아', latin: 'Begonia', category: '관엽식물' },
  { ko: '트라데스칸티아', latin: 'Tradescantia', category: '관엽식물', aliases: ['자주달개비'] },
  { ko: '접란', latin: 'Chlorophytum', category: '관엽식물', aliases: ['스파이더플랜트'] },
  { ko: '쉐플레라', latin: 'Schefflera', category: '관엽식물' },
  { ko: '파키라', latin: 'Pachira', category: '관엽식물', aliases: ['머니트리'] },
  { ko: '극락조', latin: 'Strelitzia', category: '관엽식물', aliases: ['스트렐리치아'] },
  { ko: '코르딜리네', latin: 'Cordyline', category: '관엽식물' },
  { ko: '피토니아', latin: 'Fittonia', category: '관엽식물' },
  { ko: '디스키디아', latin: 'Dischidia', category: '관엽식물' },
  { ko: '립살리스', latin: 'Rhipsalis', category: '관엽식물', note: '선인장과지만 착생 관엽으로 유통' },
  { ko: '아스플레니움', latin: 'Asplenium', category: '관엽식물', aliases: ['고사리'] },
  { ko: '박쥐란', latin: 'Platycerium', category: '관엽식물' },
  { ko: '보스턴고사리', latin: 'Nephrolepis', category: '관엽식물' },
  { ko: '아디안텀', latin: 'Adiantum', category: '관엽식물', aliases: ['공작고사리'] },
  { ko: '엽란', latin: 'Aspidistra', category: '관엽식물' },
  { ko: '테이블야자', latin: 'Chamaedorea', category: '관엽식물' },
  { ko: '아레카야자', latin: 'Dypsis', category: '관엽식물' },
  { ko: '켄차야자', latin: 'Howea', category: '관엽식물' },
  { ko: '아스파라거스', latin: 'Asparagus', category: '관엽식물' },
  { ko: '사랑초', latin: 'Oxalis', category: '관엽식물', aliases: ['옥살리스'] },
  { ko: '셀라기넬라', latin: 'Selaginella', category: '관엽식물' },

  // ── 다육식물 ────────────────────────────────────────────────
  { ko: '에케베리아', latin: 'Echeveria', category: '다육식물' },
  { ko: '하월시아', latin: 'Haworthia', category: '다육식물', aliases: ['하워르티아'] },
  { ko: '세덤', latin: 'Sedum', category: '다육식물', aliases: ['돌나물'] },
  { ko: '그랍토페탈룸', latin: 'Graptopetalum', category: '다육식물' },
  { ko: '그랍토베리아', latin: 'Graptoveria', category: '다육식물' },
  { ko: '세데베리아', latin: 'Sedeveria', category: '다육식물' },
  { ko: '셈페르비붐', latin: 'Sempervivum', category: '다육식물' },
  { ko: '크라술라', latin: 'Crassula', category: '다육식물' },
  { ko: '칼랑코에', latin: 'Kalanchoe', category: '다육식물' },
  { ko: '아에오니움', latin: 'Aeonium', category: '다육식물' },
  { ko: '파키피툼', latin: 'Pachyphytum', category: '다육식물' },
  { ko: '코틸레돈', latin: 'Cotyledon', category: '다육식물' },
  { ko: '알로에', latin: 'Aloe', category: '다육식물' },
  { ko: '가스테리아', latin: 'Gasteria', category: '다육식물' },
  { ko: '아가베', latin: 'Agave', category: '다육식물' },
  { ko: '세네시오', latin: 'Senecio', category: '다육식물', aliases: ['녹영', '그린네크리스'] },
  { ko: '리톱스', latin: 'Lithops', category: '다육식물', aliases: ['살아있는돌'] },
  { ko: '코노피툼', latin: 'Conophytum', category: '다육식물' },
  { ko: '유포르비아', latin: 'Euphorbia', category: '다육식물', note: '대극속 — 다육/괴근 종 다수' },
  { ko: '바위솔', latin: 'Orostachys', category: '다육식물' },

  // ── 선인장 ──────────────────────────────────────────────────
  { ko: '짐노칼리시움', latin: 'Gymnocalycium', category: '선인장' },
  { ko: '마밀라리아', latin: 'Mammillaria', category: '선인장' },
  { ko: '아스트로피툼', latin: 'Astrophytum', category: '선인장' },
  { ko: '에키놉시스', latin: 'Echinopsis', category: '선인장' },
  { ko: '부채선인장', latin: 'Opuntia', category: '선인장' },
  { ko: '페로칵투스', latin: 'Ferocactus', category: '선인장' },
  { ko: '레부티아', latin: 'Rebutia', category: '선인장' },

  // ── 괴근식물(코덱스) ────────────────────────────────────────
  { ko: '파키포디움', latin: 'Pachypodium', category: '괴근식물' },
  { ko: '아데니움', latin: 'Adenium', category: '괴근식물', aliases: ['사막의장미'] },
  { ko: '디오스코레아', latin: 'Dioscorea', category: '괴근식물', aliases: ['거북등'] },
  { ko: '스테파니아', latin: 'Stephania', category: '괴근식물' },
  { ko: '오페르쿨리카리아', latin: 'Operculicarya', category: '괴근식물' },

  // ── 난초 ────────────────────────────────────────────────────
  { ko: '호접란', latin: 'Phalaenopsis', category: '난초', aliases: ['팔레놉시스'] },
  { ko: '덴드로비움', latin: 'Dendrobium', category: '난초', aliases: ['석곡'] },
  { ko: '심비디움', latin: 'Cymbidium', category: '난초' },
  { ko: '카틀레야', latin: 'Cattleya', category: '난초' },
  { ko: '온시디움', latin: 'Oncidium', category: '난초' },
  { ko: '파피오페딜룸', latin: 'Paphiopedilum', category: '난초' },

  // ── 허브 ────────────────────────────────────────────────────
  { ko: '바질', latin: 'Ocimum', category: '허브' },
  { ko: '민트', latin: 'Mentha', category: '허브', aliases: ['박하'] },
  { ko: '로즈마리', latin: 'Salvia', category: '허브', note: '구 Rosmarinus officinalis → Salvia rosmarinus 재분류' },
  { ko: '타임', latin: 'Thymus', category: '허브' },
  { ko: '라벤더', latin: 'Lavandula', category: '허브' },
  { ko: '오레가노', latin: 'Origanum', category: '허브' },

  // ── 식충식물 ────────────────────────────────────────────────
  { ko: '파리지옥', latin: 'Dionaea', category: '식충식물' },
  { ko: '네펜데스', latin: 'Nepenthes', category: '식충식물', aliases: ['벌레잡이통풀'] },
  { ko: '끈끈이주걱', latin: 'Drosera', category: '식충식물' },
  { ko: '사라세니아', latin: 'Sarracenia', category: '식충식물' },

  // ── 수생식물 ────────────────────────────────────────────────
  { ko: '아누비아스', latin: 'Anubias', category: '수생식물' },
  { ko: '부세팔란드라', latin: 'Bucephalandra', category: '수생식물' },
  { ko: '크립토코리네', latin: 'Cryptocoryne', category: '수생식물' },
];
