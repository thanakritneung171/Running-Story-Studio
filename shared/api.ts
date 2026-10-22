import { z } from 'zod';
import { DesignDocumentSchema } from './design';

export const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const IdSchema = z.string().regex(ID_RE);

export const ProjectWriteSchema = z.object({
  name: z.string().min(1).max(120),
  design: DesignDocumentSchema,
  templateId: z.string().max(64).nullable().optional(),
  /** Activity metadata + track. The track is stored in R2, not D1. */
  activity: z
    .object({
      id: IdSchema,
      name: z.string().max(200),
      summary: z.record(z.unknown()),
      data: z.unknown(),
    })
    .nullable()
    .optional(),
  assetIds: z.array(IdSchema).max(100).default([]),
});
export type ProjectWrite = z.infer<typeof ProjectWriteSchema>;

export const TemplateWriteSchema = z.object({
  name: z.string().min(1).max(120),
  design: DesignDocumentSchema,
});

export interface ApiError {
  error: { code: string; message: string };
}
