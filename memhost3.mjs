// memhost3.mjs — host-plane `memory` service v3 for the DeepSeek Harness.
//
// Upgrades over v2 (memhost2.mjs):
//   - ALL entries returned to callers are `clean`ed: `undefined`-valued keys
//     are dropped so dynamic-plugin tools and the Client RPC layer receive
//     lossless JSON (a `cwd: undefined` from v2 crashed the memory-list
//     handler with "must be lossless JSON data").
//
// v2 feature set (unchanged): optional `title`, `keywords[]`, `scope`
// (`'user' | 'project' | 'session'`), `cwd`, `sessionId`, `pinned`; relevance
// search scoring content hits, keyword hits, pin bonus, and recency decay;
// per-scope/cwd/session filters on `search`/`list`; `pin(id, pinned)`.
//
// Same discipline as before: HOST row, single JSON file,
// `$DSH_HOME/memory/memories.json`, promise-chain serialized writes, and NO
// `#private` class fields (Cordis Service wrappers reject them).

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { Service } from '@deepseek-ai/cordis'

/** Where the memory store file lives. */
function storeDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'memory')
}

const STORE_FILE = () => join(storeDir(), 'memories.json')

/** The in-memory store shape: `{ version, entries: [...] }`. */
const EMPTY_STORE = Object.freeze({ version: 2, entries: [] })

/** Split a string into normalized terms (lowercase, alnum runs). */
function termsOf(text) {
  const norm = String(text || '').toLowerCase()
  const found = norm.match(/[\p{L}\p{N}]+/gu)
  return found ? [...new Set(found)] : []
}

/** Bigrams of a normalized term string (for fuzzy keyword overlap). */
function ngramsOf(text, n = 2) {
  const flat = String(text || '').replace(/\s+/g, '').toLowerCase()
  const out = new Set()
  for (let i = 0; i <= flat.length - n; i++) out.add(flat.slice(i, i + n))
  return out
}

/** Drop `undefined`-valued keys so tools/UI always receive lossless JSON. */
function clean(entry) {
  if (!entry || typeof entry !== 'object') return entry
  const out = {}
  for (const key of Object.keys(entry)) {
    const value = entry[key]
    if (value !== undefined) out[key] = value
  }
  return out
}

/**
 * Host memory service v2. Public contract:
 * - `async save(input)` — add/update one entry. Input: `{ content, tags?,
 *   id?, title?, keywords?, scope?, cwd?, sessionId?, pinned? }`. Returns the
 *   stored entry. Updating preserves omitted optional fields.
 * - `async search(query, opts?)` — relevance search; opts: `{ tags, scope,
 *   cwd, sessionId, limit }`. Pinned entries sort first, then score desc.
 * - `async list(opts?)` — newest-first; same filter opts.
 * - `async get(id)` — one entry.
 * - `async forget(id)` — delete one entry.
 * - `async pin(id, pinned)` — set the pinned flag.
 * - `async stats()` — counts incl. per-scope and pinned.
 */
export class MemoryService extends Service {
  constructor(ctx) {
    super(ctx, 'memory')
    this._chain = Promise.resolve()
    this._store = null
  }

  async _load() {
    if (this._store !== null) return this._store
    let raw = null
    try {
      raw = await fs.readFile(STORE_FILE(), 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    this._store = raw === null
      ? { ...EMPTY_STORE, entries: [] }
      : { ...EMPTY_STORE, ...JSON.parse(raw) }
    if (!Array.isArray(this._store.entries)) this._store.entries = []
    return this._store
  }

  async _persist() {
    await fs.mkdir(storeDir(), { recursive: true })
    const file = STORE_FILE()
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, JSON.stringify(this._store, null, 2), 'utf8')
    await fs.rename(tmp, file)
  }

  _enqueue(task) {
    const run = this._chain.then(task, task)
    this._chain = run.then(() => undefined, () => undefined)
    return run
  }

  _newestFirst(entries) {
    return [...entries].sort((a, b) => {
      const at = (e) => e.updatedAt ?? e.createdAt ?? ''
      return at(b) < at(a) ? -1 : at(b) > at(a) ? 1 : 0
    })
  }

  /** Normalize tags/scope/keywords inputs. */
  _normTags(input) {
    return Array.isArray(input) ? input.map(t => String(t).trim()).filter(Boolean) : []
  }

  async save(input) {
    const content = typeof input?.content === 'string' ? input.content.trim() : ''
    if (content === '') throw new Error('memory.save: content must be a non-empty string')
    const now = new Date().toISOString()
    return await this._enqueue(async () => {
      const store = await this._load()
      if (typeof input.id === 'string' && input.id !== '') {
        const existing = store.entries.find(e => e.id === input.id)
        if (existing) {
          existing.content = content
          existing.updatedAt = now
          if (input.tags !== undefined) existing.tags = this._normTags(input.tags)
          if (input.title !== undefined) existing.title = typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : existing.title
          if (input.keywords !== undefined) existing.keywords = this._normTags(input.keywords)
          if (input.scope !== undefined) existing.scope = input.scope
          if (input.cwd !== undefined) existing.cwd = typeof input.cwd === 'string' ? input.cwd : existing.cwd
          if (input.sessionId !== undefined) existing.sessionId = typeof input.sessionId === 'string' ? input.sessionId : existing.sessionId
          if (input.pinned !== undefined) existing.pinned = !!input.pinned
          await this._persist()
          return clean(existing)
        }
      }
      const entry = {
        id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        content,
        tags: this._normTags(input.tags),
        title: typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : undefined,
        keywords: this._normTags(input.keywords),
        scope: input.scope === 'project' || input.scope === 'session' ? input.scope : 'user',
        cwd: typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : undefined,
        sessionId: typeof input.sessionId === 'string' && input.sessionId !== '' ? input.sessionId : undefined,
        pinned: !!input.pinned,
        createdAt: now,
        updatedAt: now,
      }
      store.entries.push(entry)
      await this._persist()
      return clean(entry)
    })
  }

  async get(id) {
    if (typeof id !== 'string' || id === '') return undefined
    const store = await this._load()
    const entry = store.entries.find(e => e.id === id)
    return entry ? clean(entry) : undefined
  }

  /** Relevance score of one entry against a query. */
  _score(entry, query, queryTerms, queryNgrams) {
    let score = 0
    const content = String(entry.content || '')
    const haystack = content.toLowerCase()
    if (query !== '' && haystack.includes(query.toLowerCase())) score += 4
    const kw = Array.isArray(entry.keywords) ? entry.keywords.map(k => String(k).toLowerCase()) : []
    if (kw.length > 0 && queryTerms.length > 0) {
      const entryKws = new Set(kw)
      const hits = kw.filter(w => queryTerms.includes(w)).length
      score += hits * 5
      // fuzzy: shared bigrams between query and keywords
      const qn = ngramsOf(queryTerms.join(' '))
      for (const w of kw) {
        const wn = ngramsOf(w)
        let inter = 0
        for (const g of wn) if (qn.has(g)) inter++
        if (inter > 0) score += 1.5
      }
    }
    if (entry.pinned) score += 2
    // recency decay: full value under 30 days, halves at ~3 months
    const at = entry.updatedAt ?? entry.createdAt ?? ''
    const ageDays = at ? Math.max(0, (Date.now() - Date.parse(at)) / 86400000) : 0
    score *= Math.max(0.3, 1 - ageDays / 180)
    return score
  }

  async search(query = '', opts = {}) {
    const q = typeof query === 'string' ? query.trim() : ''
    const tags = Array.isArray(opts.tags) ? opts.tags.map(String) : []
    const scope = opts.scope === 'project' || opts.scope === 'session' || opts.scope === 'user' ? opts.scope : undefined
    const cwd = typeof opts.cwd === 'string' ? opts.cwd : undefined
    const sessionId = typeof opts.sessionId === 'string' ? opts.sessionId : undefined
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 20
    const store = await this._load()
    const queryTerms = termsOf(q)
    const queryNgrams = ngramsOf(q)
    const scored = []
    for (const e of store.entries) {
      if (tags.length > 0) {
        const et = Array.isArray(e.tags) ? e.tags.map(String) : []
        if (!tags.every(t => et.includes(t))) continue
      }
      if (scope !== undefined && e.scope !== scope) continue
      if (cwd !== undefined && e.cwd !== cwd) continue
      if (sessionId !== undefined && e.sessionId !== sessionId) continue
      const s = this._score(e, q, queryTerms, queryNgrams)
      if (s > 0 || (q === '' && tags.length === 0)) scored.push({ e, s })
    }
    scored.sort((a, b) => (b.e.pinned === a.e.pinned ? b.s - a.s : b.e.pinned ? 1 : -1))
    return scored.slice(0, limit).map(x => clean(x.e))
  }

  async list(opts = {}) {
    const tags = Array.isArray(opts.tags) ? opts.tags.map(String) : []
    const scope = opts.scope === 'project' || opts.scope === 'session' || opts.scope === 'user' ? opts.scope : undefined
    const cwd = typeof opts.cwd === 'string' ? opts.cwd : undefined
    const sessionId = typeof opts.sessionId === 'string' ? opts.sessionId : undefined
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 100
    const store = await this._load()
    const all = store.entries.filter(e => {
      if (tags.length > 0) {
        const et = Array.isArray(e.tags) ? e.tags.map(String) : []
        if (!tags.every(t => et.includes(t))) return false
      }
      if (scope !== undefined && e.scope !== scope) return false
      if (cwd !== undefined && e.cwd !== cwd) return false
      if (sessionId !== undefined && e.sessionId !== sessionId) return false
      return true
    })
    const sorted = this._newestFirst(all)
    sorted.sort((a, b) => (b.pinned === a.pinned ? 0 : b.pinned ? -1 : 1))
    return sorted.slice(0, limit).map(clean)
  }

  async forget(id) {
    if (typeof id !== 'string' || id === '') return false
    return await this._enqueue(async () => {
      const store = await this._load()
      const index = store.entries.findIndex(e => e.id === id)
      if (index === -1) return false
      store.entries.splice(index, 1)
      await this._persist()
      return true
    })
  }

  async pin(id, pinned = true) {
    if (typeof id !== 'string' || id === '') return false
    return await this._enqueue(async () => {
      const store = await this._load()
      const entry = store.entries.find(e => e.id === id)
      if (!entry) return false
      entry.pinned = !!pinned
      entry.updatedAt = new Date().toISOString()
      await this._persist()
      return true
    })
  }

  async stats() {
    const store = await this._load()
    const latest = store.entries.reduce((max, e) => {
      const at = e.updatedAt ?? e.createdAt ?? ''
      return at > max ? at : max
    }, '')
    const scopes = { user: 0, project: 0, session: 0 }
    let pinned = 0
    for (const e of store.entries) {
      if (e.pinned) pinned++
      scopes[e.scope === 'project' || e.scope === 'session' ? e.scope : 'user']++
    }
    return { count: store.entries.length, latestWrite: latest, pinned, scopes }
  }
}

/** Cordis plugin entry. */
export const name = 'memory-host'
export const inject = []
export function apply(ctx) {
  new MemoryService(ctx)
}

export default { name, inject, apply }