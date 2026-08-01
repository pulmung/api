export const filePurposes = [
  'plant-image',
  'user-plant-image',
  'post-image',
  'user-profile-image',
] as const;
export type FilePurpose = (typeof filePurposes)[number];
