export const clientPlatforms = ['web', 'ios', 'android'] as const;
export type ClientPlatform = (typeof clientPlatforms)[number];
