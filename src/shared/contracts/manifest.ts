import { z } from 'zod'
import { brand } from '../config/brand'

const safeRelativeTarget = z.string().min(1).max(500).refine(value => {
  const normalized = value.replace(/\\/g, '/')
  return !normalized.startsWith('/')
    && !/^[a-zA-Z]:/.test(normalized)
    && normalized.split('/').every(part => part.length > 0
      && part !== '.'
      && part !== '..'
      && !/[<>:"|?*\u0000-\u001f]/.test(part))
}, 'Target must be a safe relative path')

const httpsDownloadUrl = z.string().url().refine(value => {
  const url = new URL(value)
  return url.protocol === 'https:'
    && !url.username
    && !url.password
    && (brand.downloadHosts as readonly string[]).includes(url.hostname.toLowerCase())
}, 'Download URLs must use HTTPS and an allowlisted host')

export const manifestFileSchema = z.object({
  id: z.string().min(1).max(160),
  url: httpsDownloadUrl,
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  size: z.number().int().nonnegative(),
  type: z.enum(['mod', 'config', 'resource-pack', 'library', 'asset']),
  target: safeRelativeTarget,
  group: z.enum(['client', 'server', 'shared'])
}).strict()

export const modpackManifestSchema = z.object({
  manifestVersion: z.literal(1),
  packVersion: z.string().min(1),
  minecraftVersion: z.string().min(1),
  fabricLoaderVersion: z.string().min(1),
  javaMajorVersion: z.number().int().min(8).max(99),
  files: z.array(manifestFileSchema),
  changelog: z.object({
    added: z.array(z.string()),
    removed: z.array(z.string()),
    updated: z.array(z.string()),
    configurations: z.array(z.string())
  }).strict()
}).strict().superRefine((manifest, context) => {
  const ids = new Set<string>()
  const targets = new Set<string>()
  manifest.files.forEach((file, index) => {
    if (ids.has(file.id)) {
      context.addIssue({ code: 'custom', path: ['files', index, 'id'], message: 'Duplicate manifest file id' })
    }
    if (targets.has(file.target.replace(/\\/g, '/').toLowerCase())) {
      context.addIssue({ code: 'custom', path: ['files', index, 'target'], message: 'Duplicate manifest target path' })
    }
    ids.add(file.id)
    targets.add(file.target.replace(/\\/g, '/').toLowerCase())
  })
})

export type ModpackManifest = z.infer<typeof modpackManifestSchema>
