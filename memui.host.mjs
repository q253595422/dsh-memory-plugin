// memui.host.mjs — Host half of the memory panel dynamic plugin.
//
// Load via cordis_define (dynamic Plugin), NOT via cordis.patch.yml:
// dynamic Plugins live in the current process only and need browser
// approval on first run. See memui.install.md.
//
// This half serves memory data to the browser panel over Package-private
// RPC. It depends on the `memory` service published by memhost3.mjs.

// code.host body (serialized into the Plugin definition):
return {
  apply(ctx) {
    const memory = ctx.get('memory')
    if (!memory) {
      console.log('[memui-host] memory service unavailable')
      return
    }
    function leaf(e) {
      return {
        id: e && e.id ? e.id : '',
        title: e && typeof e.title === 'string' ? e.title : '',
        content: e && typeof e.content === 'string' ? e.content : '',
        tags: Array.isArray(e && e.tags) ? e.tags.filter(function (t) { return typeof t === 'string' }) : [],
        keywords: Array.isArray(e && e.keywords) ? e.keywords.filter(function (k) { return typeof k === 'string' }) : [],
        scope: e && typeof e.scope === 'string' ? e.scope : '',
        pinned: !!(e && e.pinned),
        createdAt: e && typeof e.createdAt === 'string' ? e.createdAt : '',
        updatedAt: e && typeof e.updatedAt === 'string' ? e.updatedAt : '',
      }
    }
    harness.handle('mem.list', async function (args) {
      const a = args && typeof args === 'object' ? args : {}
      const query = typeof a.query === 'string' ? a.query : ''
      const limit = Number.isInteger(a.limit) && a.limit > 0 && a.limit <= 500 ? a.limit : 200
      const items = query ? await memory.search(query, { limit: limit }) : await memory.list({ limit: limit })
      return { entries: (items || []).map(leaf) }
    })
    harness.handle('mem.pin', async function (args) {
      const a = args && typeof args === 'object' ? args : {}
      const id = typeof a.id === 'string' ? a.id : ''
      if (!id) return { ok: false, error: 'missing id' }
      try {
        const res = await memory.pin(id, !!a.pinned)
        return { ok: true, entry: leaf(res) }
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) }
      }
    })
    harness.handle('mem.forget', async function (args) {
      const a = args && typeof args === 'object' ? args : {}
      const id = typeof a.id === 'string' ? a.id : ''
      if (!id) return { ok: false, error: 'missing id' }
      try {
        await memory.forget(id)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) }
      }
    })
    console.log('[memui-host] handlers registered')
  },
}