import { z } from 'zod';
import { clientPlatforms } from '../../domain/client-platform';

export const deviceFields = {
  platform: z.enum(clientPlatforms),
  deviceName: z.string().optional(),
};
