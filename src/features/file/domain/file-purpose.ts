export const filePurposes = ['plant-image'] as const;
export type FilePurpose = (typeof filePurposes)[number];
