import sanitizeHtml from 'sanitize-html';
import { POST_IMAGE_KEY_PREFIX } from './post-image';
import {
  InvalidPostContentError,
  InvalidPostImageSrcError,
} from './post.error';

// 글자색 팔레트 — 시맨틱 이름의 닫힌 집합. raw hex를 허용하면 다크모드에서 깨진다
// (검정 글자 → 다크 배경에서 실종). 실제 색값은 클라가 테마별로 매핑한다.
// sanitize allowedClasses와 API 문서(.meta) 양쪽의 단일 소스.
export const POST_TEXT_COLORS = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
] as const;
export type PostTextColor = (typeof POST_TEXT_COLORS)[number];
// wire 표현: <span class="color-red">
export const POST_COLOR_CLASSES = POST_TEXT_COLORS.map(
  (color) => `color-${color}`,
);

// 불변식 한도 — DTO(Zod 경계)도 이 값을 import해 이중기재 drift를 막는다.
export const POST_CONTENT_MAX_LENGTH = 50_000; // sanitize 전 원문 기준
export const POST_IMAGES_MAX = 20; // 고유 key 기준
export const POST_EXCERPT_MAX_LENGTH = 200; // 코드포인트 기준

// 정화 + 파생의 묶음 — 이 파이프라인의 산출물이자 Post/PostPatch 팩토리의 입력 단위.
// 파생 3필드는 content의 순수 투영이라 따로 조립할 수 없어야 한다 — 엔티티 필드는
// 평평하지만 팩토리가 이 묶음만 받으므로 "본문만 갱신되고 파생이 남는" 상태는 표현 불가.
export type ProcessedPostContent = {
  content: string;
  excerpt: string;
  thumbnailKey: string | null;
  imageKeys: string[];
};

/**
 * 게시글 본문 파이프라인 — 순수 함수(결정적·I/O 없음, 도메인 내 uuidv7과 같은 결).
 * "sanitize를 통과한 HTML만 저장"(post.schema.ts 규율 ①)의 유일한 통로다.
 *
 * 2-pass인 이유: 정화(Pass A) 후 그 출력에서 추출(Pass B)해야 "파생 ≡ 저장본"이
 * 구조적으로 보장된다 — 정화 패스 안에서 hook으로 수집하면 후속 필터 단계가 버릴
 * 노드를 관찰해 과수집할 수 있다. 본문은 50k 상한이라 2-pass 비용은 무의미하다.
 *
 * @param parseImageKey URL→key 역매핑 — file feature(PublicFileUrlResolver.tryParseKey)가
 *   소유한 로직을 함수 값으로 주입받는다(도메인 순수성 유지 + 매핑 단일 소스).
 */
export function processPostContent(
  rawHtml: string,
  opts: { parseImageKey: (url: string) => string | null },
): ProcessedPostContent {
  // 원문 기준 상한 — sanitize가 줄여주기 전에 자원 남용을 차단(DTO max와 이중 방어).
  if (rawHtml.length > POST_CONTENT_MAX_LENGTH) {
    throw new InvalidPostContentError();
  }

  const content = cleanHtml(rawHtml, opts.parseImageKey);
  const imageKeys = extractImageKeys(content, opts.parseImageKey);
  const excerpt = extractExcerpt(content);

  if (imageKeys.length > POST_IMAGES_MAX) {
    throw new InvalidPostContentError();
  }
  // 알맹이 0(텍스트도 이미지도 없음) — 공백·빈 서식만으로는 글이 아니다.
  // 이미지-only 글은 정상(excerpt '' 허용, 목록 프리뷰는 썸네일이 담당).
  if (excerpt === '' && imageKeys.length === 0) {
    throw new InvalidPostContentError();
  }

  return {
    content,
    excerpt,
    thumbnailKey: imageKeys[0] ?? null, // 문서 순서 첫 이미지 = 대표
    imageKeys,
  };
}

// Pass A — 정화. 허용: 문단(p·br)·볼드(strong)·삭선(s)·글자색(span class)·이미지(img src).
function cleanHtml(
  rawHtml: string,
  parseImageKey: (url: string) => string | null,
): string {
  return sanitizeHtml(rawHtml, {
    allowedTags: ['p', 'br', 'strong', 's', 'span', 'img'],
    // class는 allowedClasses가 담당(여기 두면 모든 class가 통과해버린다).
    // style은 어디에도 없음 = 전부 제거 — 글자색을 팔레트 class로 강제(다크모드 보호, 규율 ④).
    allowedAttributes: { img: ['src'] },
    allowedClasses: { span: [...POST_COLOR_CLASSES] },
    transformTags: {
      // 에디터별 표기 정규화 — 저장본의 문법을 하나로.
      b: 'strong',
      del: 's',
      strike: 's',
      // src 검증은 원문에서 — 잘못된 이미지는 조용히 떨어뜨리지 않고 422로 알린다
      // (대개 에디터 연동 버그 신호. 규율 ③: 우리 이미지 도메인 + post-image purpose만).
      img: (tagName, attribs) => {
        const key = parseImageKey(attribs.src ?? '');
        if (key === null || !key.startsWith(POST_IMAGE_KEY_PREFIX)) {
          throw new InvalidPostImageSrcError();
        }
        return { tagName, attribs: { src: attribs.src } };
      },
    },
    disallowedTagsMode: 'discard', // 태그만 벗기고 텍스트는 보존 (script/style 내용은 통째 드랍 — 기본 nonTextTags)
    // javascript:·data: 차단. 도메인 강제는 위 transform이 하므로 스킴은 넓게(http 로컬 dev 허용).
    allowedSchemes: ['http', 'https'],
    allowProtocolRelative: false,
  });
}

// Pass B-1 — 이미지 key 수집 (정화된 출력 대상이라 전부 유효한 src임이 보장됨).
function extractImageKeys(
  cleanedHtml: string,
  parseImageKey: (url: string) => string | null,
): string[] {
  const keys: string[] = [];
  sanitizeHtml(cleanedHtml, {
    allowedTags: ['img'],
    allowedAttributes: { img: ['src'] },
    transformTags: {
      img: (tagName, attribs) => {
        const key = parseImageKey(attribs.src ?? '');
        if (key !== null) keys.push(key);
        return { tagName, attribs };
      },
    },
  });
  // 같은 이미지 중복 삽입은 허용하되 key 인덱스(GC 스캔·head 검증)는 고유하게.
  return [...new Set(keys)];
}

// Pass B-2 — 플레인텍스트 발췌 (목록 프리뷰용).
function extractExcerpt(cleanedHtml: string): string {
  // 1) 인라인 태그(strong·s·span·img)만 벗긴다 — 인라인은 단어 중간에 낄 수 있어
  //    ("안<strong>녕</strong>" → "안녕") 공백을 넣으면 안 된다.
  const blocksOnly = sanitizeHtml(cleanedHtml, {
    allowedTags: ['p', 'br'],
    allowedAttributes: {},
  });
  // 2) 블록 경계만 공백으로. 1)의 출력 문법은 정확히 <p>·</p>·<br /> 셋뿐(속성 없음)이라
  //    문자열 치환이 휴리스틱이 아니다. 텍스트에 유저가 친 "<p>"는 &lt;p&gt;로 이스케이프돼
  //    있어 오매치 불가.
  const text = blocksOnly
    .replaceAll('<p>', ' ')
    .replaceAll('</p>', ' ')
    .replaceAll('<br />', ' ');
  // 3) sanitize-html이 이스케이프한 엔티티 복원 → 공백 collapse → 코드포인트 절단(이모지 안전).
  const normalized = decodeEscapedEntities(text).replace(/\s+/g, ' ').trim();
  return [...normalized].slice(0, POST_EXCERPT_MAX_LENGTH).join('');
}

// sanitize-html 텍스트 출력의 이스케이프 집합(& < > ")만 복원한다. 원문 엔티티는
// 파서가 이미 디코드했으므로 이 넷이 전부다. &amp;는 마지막 — 이중 디코드 방지
// ("&amp;lt;" → "&lt;"가 정답이지 "<"가 아니다).
function decodeEscapedEntities(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');
}
