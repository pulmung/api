export const filePurposes = [
  'plant-image',
  'user-plant-image',
  'post-image',
] as const;
export type FilePurpose = (typeof filePurposes)[number];
