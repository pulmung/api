export const socialProviders = ['kakao', 'google'] as const;
export type SocialProvider = (typeof socialProviders)[number];
