// memory-inject2.mjs — host-plane memory recall injection (rev B).
//
// Registers one `systemPrompt.section` (`memory:recall`, order 95 — after the
// persona, before tool guidance at 100+) whose text is a SHORT snapshot of the
// shared memory store: pinned entries first (④ fixed facts are always in
// context), then the newest few auto/conversation summaries with their
// ③ titles. This makes long-term knowledge actively available to every model
// request without the model having to remember to call `memory_search`.
//
// Rev B fix: the refresh timer no longer gates on a `dirty` flag set only by
// `turn-stopping`. Tool-driven writes (e.g. a probe seeding the store) never
// emit that event, which left the snapshot stale indefinitely. The interval
// now refreshes unconditionally (cheap: one `list` + string join), while
// `turn-stopping` still triggers an immediate refresh so a new auto entry
// shows up in the very next assembly.
//
// The section provider is SYNCHRONOUS, so this row keeps a rendered-text
// snapshot in memory. Text stays small (title + one-line summary, clipped).
// HOST row; lives in cordis.patch.yml after `memory-host`; no `#private`.

/** Clip a line to a max length. */
function clip(text, max) {
  const s = String(text || '')
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}

/** Render one entry as a compact single line. */
function lineOf(entry) {
  const title = entry.title || '（无标题）'
  const summary = clip(String(entry.content || '').replace(/\s+/g, ' ').trim(), 120)
  const pin = entry.pinned ? '⭐ ' : ''
  const kw = Array.isArray(entry.keywords) && entry.keywords.length > 0
    ? `（关键词：${entry.keywords.slice(0, 4).join('、')}）`
    : ''
  return `${pin}${title}：${summary}${kw}`
}

export const name = 'memory-inject'
export const inject = ['systemPrompt']

export function apply(ctx) {
  let snapshotText = ''

  const refresh = async () => {
    const memory = ctx.get('memory')
    if (memory === undefined) return
    try {
      const entries = await memory.list({ limit: 100 })
      const sorted = [...entries].sort((a, b) => (b.pinned === a.pinned ? 0 : b.pinned ? -1 : 1))
      const pinnedPart = sorted.filter(e => e.pinned).slice(0, 8)
      const recentPart = sorted.filter(e => !e.pinned).slice(0, 6)
      const lines = [...pinnedPart, ...recentPart].map(lineOf)
      snapshotText = lines.length === 0 ? '' : '# 相关记忆（自动注入）\n' + lines.join('\n')
    } catch (error) {
      console.error('[memory-inject] refresh failed:', error)
    }
  }

  // Initial fill and periodic unconditional refresh (cheap; keeps tool writes visible).
  void refresh()
  const timer = ctx.get('timer')
  if (timer !== undefined && typeof timer.interval === 'function') {
    timer.interval(() => void refresh(), 15000)
  }
  // Immediate refresh after auto-memory writes a new turn.
  ctx.on('agent/turn-stopping', () => void refresh())

  ctx.systemPrompt.section({
    name: 'memory:recall',
    order: 95,
    text: () => snapshotText,
  })
}

export default { name, inject, apply }