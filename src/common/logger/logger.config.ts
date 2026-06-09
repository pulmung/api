import { ConfigService } from '@nestjs/config';
import { LoggerModule, Params } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { uuidv7 } from 'uuidv7';
import type { Env } from '../../config/env.validation';

export const loggerModule = LoggerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): Params => {
    const isProd = config.get('NODE_ENV', { infer: true }) === 'production';

    return {
      pinoHttp: {
        level: config.get('LOG_LEVEL', { infer: true }),
        serializers: {
          req: (req: IncomingMessage & { id: string }) => ({
            id: req.id,
            method: req.method,
            url: req.url,
          }),
          res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
        },

        // 요청 상관관계 id: 들어온 x-request-id 를 이어받고(분산 추적),
        // 없으면 uuidv7 생성 + 응답 헤더로 에코(클라/프록시가 되짚게)
        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];
          if (incoming) return Array.isArray(incoming) ? incoming[0] : incoming;
          const id = uuidv7();
          res.setHeader('x-request-id', id);
          return id;
        },
        redact: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
        ],
        // dev 만 사람이 읽는 컬러 출력. prod 는 raw JSON 한 줄(undefined)
        transport: isProd
          ? undefined
          : {
              target: 'pino-pretty',
              options: { singleLine: true, translateTime: 'SYS:standard' },
            },
      },
    };
  },
});
