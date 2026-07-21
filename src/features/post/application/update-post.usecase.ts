import { Injectable } from '@nestjs/common';
import { S3FileStorage } from '../../file/infrastructure/s3-file.storage';
import { PublicFileUrlResolver } from '../../file/infrastructure/public-file-url.resolver';
import { processPostContent } from '../domain/post-content';
import { PostPatch } from '../domain/post';
import {
  PostImageNotUploadedError,
  PostNotFoundError,
} from '../domain/post.error';
import { PostWriter } from '../repository/post.writer';

@Injectable()
export class UpdatePostUseCase {
  constructor(
    private readonly storage: S3FileStorage,
    private readonly urlResolver: PublicFileUrlResolver,
    private readonly postWriter: PostWriter,
  ) {}

  async execute(command: {
    id: string;
    authorId: string;
    title?: string;
    content?: string;
    plantId?: string | null;
  }): Promise<void> {
    // 파생 재계산은 content 제공 시에만 — title/plantId-only 패치는 본문·파생을 건드리지
    // 않는다. 싼 불변식(sanitize·title 검증) 먼저, S3 왕복은 그 뒤(create와 동일 순서).
    const content =
      command.content === undefined
        ? undefined
        : processPostContent(command.content, {
            parseImageKey: (url) => this.urlResolver.tryParseKey(url),
          });
    const patch = PostPatch.create({
      title: command.title,
      content,
      plantId: command.plantId,
    });

    // content가 제공된 경우에만 head 실존 검증 — 미제공이면 저장된 key를 재검증하지
    // 않는다(작성/직전 수정 시점에 이미 검증됨). 이 422가 존재 확인(아래 update)보다
    // 먼저 발화하지만 존재 여부와 무관한 에러라 누출이 없다(user-plant와 동일 결).
    if (content !== undefined) {
      const heads = await Promise.all(
        content.imageKeys.map((key) => this.storage.head(key)),
      );
      if (heads.some((head) => head === null)) {
        throw new PostImageNotUploadedError();
      }
    }

    const updated = await this.postWriter.update(
      command.id,
      command.authorId,
      patch,
    );
    // 비존재·타인 글 수렴(존재 은닉) — 404 하나로.
    if (!updated) throw new PostNotFoundError();
    // 커맨드라 반환 없음 — 응답 표현(조회 DTO)은 컨트롤러가 재조회로 만든다.
  }
}
