// index.mjs — Host-side aggregate entry for dsh-memory-plugin.
//
// Re-exports the three host rows so callers can load them as a single
// compound plugin (e.g. `name: 'dsh-memory-plugin/host/memhost'`).
// Each submodule is its own cordis plugin; this barrel simply re-exports
// so the package root is also usable.

export { MemoryService } from './memhost3.mjs'
export { name as autoMemoryName, inject as autoMemoryInject, apply as autoMemoryApply } from './auto-memory5.mjs'
export { name as injectName, inject as injectInject, apply as injectApply } from './memory-inject2.mjs'

// As a convenience, export the default objects so a consumer can
// register them individually or pass the array to a compose step:
export const hostPlugins = [
  (await import('./memhost3.mjs')).default,
  (await import('./auto-memory5.mjs')).default,
  (await import('./memory-inject2.mjs')).default,
]

export default {
  name: 'dsh-memory-plugin',
  inject: [],
  apply(ctx) {
    // Aggregate apply: instantiate each plugin's apply so consumers
    // don't need to register three separate rows manually.
    const memhost = await import('./memhost3.mjs')
    const autoMemory = await import('./auto-memory5.mjs')
    const inject = await import('./memory-inject2.mjs')
    memhost.default.apply(ctx)
    autoMemory.default.apply(ctx)
    inject.default.apply(ctx)
  },
}
