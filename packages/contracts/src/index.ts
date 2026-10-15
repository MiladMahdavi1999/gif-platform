import { z } from 'zod';

export const readinessSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    database: z.enum(['up', 'down']),
    storage: z.enum(['up', 'down']),
  }),
});

export type Readiness = z.infer<typeof readinessSchema>;
