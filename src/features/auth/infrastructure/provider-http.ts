import { ServiceUnavailableException } from '@nestjs/common';

export interface ProviderResponse {
  status: number;
  body: unknown;
}

/**
 * provider introspection 호출 공용 헬퍼 (native fetch).
 * 네트워크 실패/타임아웃은 외부 장애 → 503 으로 통일한다.
 * 상태코드별 의미(400/401 vs 5xx) 해석은 각 verifier 의 책임.
 */
export async function providerGet(
  url: string,
  init?: RequestInit,
): Promise<ProviderResponse> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
  } catch {
    throw new ServiceUnavailableException('social provider unreachable');
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}
