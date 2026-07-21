import { Injectable } from '@nestjs/common';
import { S3FileStorage } from '../../file/infrastructure/s3-file.storage';
import { PublicFileUrlResolver } from '../../file/infrastructure/public-file-url.resolver';
import { processPostContent } from '../domain/post-content';
import { Post } from '../domain/post';
import { PostImageNotUploadedError } from '../domain/post.error';
import { PostWriter } from '../repository/post.writer';

@Injectable()
export class CreatePostUseCase {
  constructor(
    private readonly storage: S3FileStorage,
    private readonly urlResolver: PublicFileUrlResolver,
    private readonly postWriter: PostWriter,
  ) {}

  async execute(command: {
    authorId: string;
    title: string;
    content: string;
    plantId?: string;
  }): Promise<{ id: string }> {
    // 싼 불변식 먼저 — sanitize(정화+파생 추출)는 순수 CPU라 S3 왕복 전에 끝낸다.
    // URL→key 역매핑은 file feature 소유(resolve의 역) — 함수 값으로 주입(도메인 순수성).
    const content = processPostContent(command.content, {
      parseImageKey: (url) => this.urlResolver.tryParseKey(url),
    });
    const post = Post.create({
      authorId: command.authorId,
      title: command.title,
      content,
      plantId: command.plantId,
    });

    // 첨부 시점 실존 검증(docs/file-upload.md §1) — presign만 받고 업로드 안 한 key 차단.
    // 이미지 없는 글이면 no-op(분기 불필요).
    const heads = await Promise.all(
      content.imageKeys.map((key) => this.storage.head(key)),
    );
    if (heads.some((head) => head === null)) {
      throw new PostImageNotUploadedError();
    }

    // plantId 실존 검증은 writer의 FK 23503 변환이 담당 — 사전 SELECT 없음.
    await this.postWriter.create(post);

    // 커맨드 결과는 식별자만 — 응답 표현(조회 DTO)은 컨트롤러가 재조회로 만든다.
    return { id: post.id };
  }
}
