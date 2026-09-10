import { z } from 'zod';

export const createLinkSchema = z.object({
  url: z.string().min(1).max(2048),
  customAlias: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  expiresAt: z.string().datetime().optional(),
  password: z.string().min(4).max(128).optional(),
  maxClicks: z.number().int().positive().optional(),
  redirectType: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).default(302),
  tags: z.array(z.string().min(1).max(32)).max(20).optional(),
  title: z.string().max(200).optional(),
});
export type CreateLinkInput = z.infer<typeof createLinkSchema>;

export const updateLinkSchema = z.object({
  destinationUrl: z.string().min(1).max(2048).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  maxClicks: z.number().int().positive().nullable().optional(),
  tags: z.array(z.string().min(1).max(32)).max(20).optional(),
  title: z.string().max(200).nullable().optional(),
});
export type UpdateLinkInput = z.infer<typeof updateLinkSchema>;

export const listLinksQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  tag: z.string().optional(),
  status: z.enum(['active', 'disabled', 'expired', 'pending_review', 'blocked']).optional(),
});
export type ListLinksQuery = z.infer<typeof listLinksQuerySchema>;

export const bulkCreateSchema = z.object({
  links: z.array(createLinkSchema.omit({ password: true })).min(1).max(500),
});
export type BulkCreateInput = z.infer<typeof bulkCreateSchema>;

export const verifyPasswordSchema = z.object({
  password: z.string().min(1).max(128),
});

// Deliberately minimal — the anonymous "quick shorten" endpoint (no login
// required, matches the classic bitly/TinyURL homepage experience) only
// accepts a URL. Custom aliases, passwords, expiry and click caps all
// require an account, both so an anonymous visitor can't squat a
// human-readable alias, and so link management (edit/delete/analytics)
// has an owner to authenticate against later.
export const quickCreateSchema = z.object({
  url: z.string().min(1).max(2048),
});
export type QuickCreateInput = z.infer<typeof quickCreateSchema>;
