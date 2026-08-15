// index.mjs — Host-side aggregate entry for dsh-memory-plugin.
// Re-exports the three host rows so callers can load them as a single
// compound plugin (e.g. name: 'dsh-memory-plugin/host/memhost').

export { MemoryService } from './memhost3.mjs'
export { name as autoMemoryName, inject as autoMemoryInject, apply as autoMemoryApply, default as autoMemoryPlugin } from './auto-memory5.mjs'
export { name as injectName, inject as injectInject, apply as injectApply, default as injectPlugin } from './memory-inject2.mjs'

// Convenience: export all three defaults as an array for programmatic composition.
export const hostPlugins = [
  (await import('./memhost3.mjs')).default,
  (await import('./auto-memory5.mjs')).default,
  (await import('./memory-inject2.mjs')).default,
]

export default {
  name: 'dsh-memory-plugin',
  inject: [],
  async apply(ctx) {
    const [m1, m2, m3] = await Promise.all([
      import('./memhost3.mjs'),
      import('./auto-memory5.mjs'),
      import('./memory-inject2.mjs'),
    ])
    m1.default.apply(ctx)
    m2.default.apply(ctx)
    m3.default.apply(ctx)
  },
}