import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['test/**/*.e2e-spec.ts'],
          // env는 테스트 파일 import 전에 세팅해야 한다(ConfigModule 스냅샷 시점) — test-env.ts 주석 참조.
          setupFiles: ['./test/helpers/test-env.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
