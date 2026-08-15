// memtools2.mjs — model-facing memory tools v2 for the `memory` agent preset.
//
// v2 over memtools.mjs:
//   - entry schema exposes the v3 store fields: title, keywords, scope, cwd,
//     sessionId, pinned;
//   - memory_save passes through title/keywords/scope;
//   - memory_search / memory_list accept a `scope` filter;
//   - new memory_pin tool (④ fixed important memories, sort-first, never
//     auto-merged or consolidated away);
//   - memory_info reports per-scope counts and pinned count.
//
// Same discipline: dependency-free (no `@deepseek-ai/*` imports — a preset
// lives under the user's home with no node_modules), everything comes from
// the `ctx` argument and the host `memory` service.

const M = 'memory'

/** Shared output schema fragment for "one memory entry". Value schema only — no `required` (parameter-only keyword). */
const entryProps = {
  id: { type: 'string' },
  content: { type: 'string' },
  tags: { type: 'array', items: { type: 'string' } },
  title: { type: 'string' },
  keywords: { type: 'array', items: { type: 'string' } },
  scope: { type: 'string' },
  cwd: { type: 'string' },
  sessionId: { type: 'string' },
  pinned: { type: 'boolean' },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
}

const scopeOf = (v) => (v === 'project' || v === 'session' || v === 'user' ? v : undefined)

/** Render any JSON value as one text block. */
function renderText(_args, value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

/** Normalize an optional limit argument. */
function limitOf(value, fallback) {
  return Number.isInteger(value) && value > 0 && value <= 200 ? value : fallback
}

/** The host memory service, or a descriptive throw. */
function memory(ctx) {
  const service = ctx.get(M)
  if (service === undefined) {
    throw new Error('memory service is not mounted: the memory-host row is missing from the host composition')
  }
  return service
}

export const name = 'tool-memory'
export const inject = ['tools', 'systemPrompt']

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'tool:memory',
    order: 90,
    text: 'The memory tools read and write a durable, cross-session memory store (one file under the harness home). Use memory_save to persist facts, decisions, or preferences you want to recall later, and memory_search before answering anything that depends on what you may have learned earlier. Search is relevance-ranked (pinned first, recency-decayed; matches both content and entry keywords). Pin important entries with memory_pin so they sort first and are never auto-merged away. The store is shared by every session on this harness.',
  })

  ctx.tools.register({
    name: 'memory_save',
    description: 'Save one memory entry (a fact, decision, preference, or note) to the shared durable store. Returns the stored entry with its id. Supports optional title, keywords, scope.',
    parameters: {
      content: { type: 'string', required: true, description: 'The memory text to store.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for filtering, e.g. ["project-x", "decision"].' },
      id: { type: 'string', description: 'Optional existing entry id to update instead of adding a new entry.' },
      title: { type: 'string', description: 'Optional short title (shown in the visualizer and recall injection).' },
      keywords: { type: 'array', items: { type: 'string' }, description: 'Optional 2-6 search keywords for keyword-based retrieval.' },
      scope: { type: 'string', description: 'Optional tier: user | project | session.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: entryProps },
      render: renderText,
    },
    async execute(args) {
      return await memory(ctx).save({
        content: args.content,
        tags: args.tags,
        id: args.id,
        title: args.title,
        keywords: args.keywords,
        scope: scopeOf(args.scope),
      })
    },
  })

  ctx.tools.register({
    name: 'memory_search',
    description: 'Search the shared memory store. Relevance search over content + keywords (pinned first, recency decayed; a query like "怎么落盘" can hit an entry keyworded "持久化"). Optionally filter by tags and/or scope tier.',
    parameters: {
      query: { type: 'string', description: 'Search text; matched against entry content and keywords. Empty matches all (when no tags given).' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Require every listed tag on returned entries.' },
      scope: { type: 'string', description: 'user | project | session filter.' },
      limit: { type: 'integer', description: 'Maximum entries to return (1-200, default 20).' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { entries: { type: 'array', items: { type: 'object', additionalProperties: false, properties: entryProps } } },
      },
      render: renderText,
    },
    async execute(args) {
      const entries = await memory(ctx).search(args.query ?? '', {
        tags: args.tags,
        scope: scopeOf(args.scope),
        limit: limitOf(args.limit, 20),
      })
      return { entries }
    },
  })

  ctx.tools.register({
    name: 'memory_list',
    description: 'List entries from the shared memory store, optionally filtered by tags and/or scope tier. Newest first, pinned first, up to `limit` entries.',
    parameters: {
      tags: { type: 'array', items: { type: 'string' }, description: 'Require every listed tag on returned entries.' },
      scope: { type: 'string', description: 'user | project | session filter.' },
      limit: { type: 'integer', description: 'Maximum entries to return (1-200, default 100).' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { entries: { type: 'array', items: { type: 'object', additionalProperties: false, properties: entryProps } } },
      },
      render: renderText,
    },
    async execute(args) {
      const entries = await memory(ctx).list({
        tags: args.tags,
        scope: scopeOf(args.scope),
        limit: limitOf(args.limit, 100),
      })
      return { entries }
    },
  })

  ctx.tools.register({
    name: 'memory_forget',
    description: 'Delete one memory entry by id. Returns whether an entry was removed.',
    parameters: { id: { type: 'string', required: true, description: 'Entry id returned by memory_save / memory_search / memory_list.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { removed: { type: 'boolean' } } },
      render: renderText,
    },
    async execute(args) {
      return { removed: await memory(ctx).forget(args.id) }
    },
  })

  ctx.tools.register({
    name: 'memory_pin',
    description: 'Pin or unpin an important memory entry so it sorts first in search/list and is never auto-merged or consolidated away by the automatic memory pipeline.',
    parameters: {
      id: { type: 'string', required: true, description: 'Entry id.' },
      pinned: { type: 'boolean', description: 'True to pin, false to unpin. Defaults to pin.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { pinned: { type: 'boolean' } } },
      render: renderText,
    },
    async execute(args) {
      return { pinned: await memory(ctx).pin(args.id, args.pinned !== false) }
    },
  })

  ctx.tools.register({
    name: 'memory_info',
    description: 'Report how many entries the shared memory store holds, how many are pinned, the per-scope breakdown (user/project/session), and when the latest write happened.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          count: { type: 'integer' },
          latestWrite: { type: 'string' },
          pinned: { type: 'integer' },
          scopes: {
            type: 'object', additionalProperties: false,
            properties: { user: { type: 'integer' }, project: { type: 'integer' }, session: { type: 'integer' } },
          },
        },
      },
      render: renderText,
    },
    async execute() {
      return await memory(ctx).stats()
    },
  })
}

export default { name, inject, apply }