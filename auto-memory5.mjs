// auto-memory5.mjs — host-plane automatic memory v5 (Memorax-inspired).
//
// 借鉴 Memorax Code 的四类 Memory 架构：
// - coding: 工程经验（已验证的修复、失败方案、设计依据、常见陷阱）
// - repo: 仓库知识（架构地图、模块职责、历史证据）
// - personal: 个人偏好（沟通风格、解释深度、结果呈现）
// - procedure: 流程记忆（可复用步骤、检查清单、前置条件）
//
// v5 改进：
// 1. 自动分类：根据对话内容自动识别 memory type
// 2. 仓库作用域：按 cwd 自动识别 project scope
// 3. 结构化摘要：LLM 输出包含 type/title/summary/keywords
// 4. 知识卡片：≥12 条同类候选自动 LLM 聚类合并
//
// Fire-and-forget inside turn-stopping; never blocks turn close.

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** Clip a string to a max length at a word boundary. */
function clip(text, max) {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const last = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'))
  return (last > max * 0.6 ? cut.slice(0, last) : cut) + '…'
}

/** Join the text blocks of a content array. */
function blockText(blocks) {
  if (!Array.isArray(blocks)) return ''
  const out = []
  for (const block of blocks) {
    if (block && block.type === 'text' && typeof block.text === 'string') out.push(block.text)
  }
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

/** Extract one turn's human request + final assistant text from the session log. */
function extractTurn(events, targetTurn) {
  let userText = ''
  let assistantText = ''
  for (const ev of events) {
    const data = ev.data || {}
    if (ev.type === 'turn/start') {
      if (data.turn > targetTurn) break
      userText = ''
    } else if (ev.type === 'user/message') {
      if (data.source && data.source.kind === 'user') {
        userText = blockText(data.content)
      }
    } else if (ev.type === 'assistant/message') {
      if (data.turn === targetTurn) {
        const text = blockText(data.message && data.message.content)
        if (text.trim() !== '') assistantText = text
      }
    }
  }
  return { userText, assistantText }
}

/** Character bigrams of normalized text, as a Set. */
function bigramsOf(text) {
  const n = String(text).replace(/\s+/g, '').toLowerCase()
  const set = new Set()
  for (let i = 0; i < n.length - 1; i++) set.add(n.slice(i, i + 2))
  return set
}

/** Jaccard similarity between two strings (0..1) over character bigrams. */
function textSimilarity(a, b) {
  const A = bigramsOf(a)
  const B = bigramsOf(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter)
}

/** The user line of a stored auto entry, or ''. */
function userLineOf(entry) {
  const content = String(entry && entry.content ? entry.content : '')
  const idx = content.indexOf('\n')
  const first = idx === -1 ? content : content.slice(0, idx)
  return first.replace(/^用户[:：]\s*/, '').trim()
}

/** Memory types inspired by Memorax Code */
const MEMORY_TYPES = ['coding', 'repo', 'personal', 'procedure']
const DEFAULT_TYPE = 'coding'

/** Summarize conversation text into structured memory via LLM. */
async function summarizeStructured(ctx, agent, userText, assistantText) {
  const llm = ctx.get('llm')
  const provider = agent && agent.options && agent.options.provider
  const model = agent && agent.options && agent.options.model
  if (!llm || !provider || !model) return null
  try {
    const prompt = `用户：${userText}\n助手：${assistantText}`
    const stream = llm.stream({
      provider,
      model,
      system: `你是记忆整理助手。分析对话内容，提取有价值的记忆。
只输出一个 JSON 对象，不要任何其他文本。格式：
{
  "type": "${MEMORY_TYPES.join('|')}中的一个",
  "title": "不超过12字的标题",
  "summary": "1-3句中文要点",
  "keywords": ["2到5个检索关键词"]
}
- coding: 工程经验（修复、失败方案、设计依据、陷阱）
- repo: 仓库知识（架构、模块、历史）
- personal: 个人偏好（沟通风格、解释深度）
- procedure: 流程记忆（步骤、检查清单、条件）`,
      messages: [{
        role: 'user',
        id: `auto-sum-${Date.now().toString(36)}`,
        source: { kind: 'user' },
        content: [{ type: 'text', text: prompt }],
      }],
      temperature: 0.2,
      maxTokens: 400,
    })
    let text = ''
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'finish') break
    }
    const cleaned = text.replace(/```(json)?/gi, '').trim()
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start === -1 || end <= start) throw new Error('no JSON object in model output')
    const parsed = JSON.parse(cleaned.slice(start, end + 1))
    
    // Validate and normalize
    const type = MEMORY_TYPES.includes(parsed.type) ? parsed.type : DEFAULT_TYPE
    const summary = typeof parsed.summary === 'string' ? parsed.summary.replace(/\s+/g, ' ').trim() : ''
    const title = typeof parsed.title === 'string' ? parsed.title.trim().slice(0, 24) : ''
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.map(k => String(k).trim()).filter(Boolean).slice(0, 6)
      : []
    
    if (summary === '') throw new Error('empty summary')
    return { type, title, summary, keywords }
  } catch (error) {
    console.error('[auto-memory] structured summarization failed:', error)
    return null
  }
}

/** Merge the incoming turn into the store; returns the final entry. */
async function recordTurn(ctx, memory, agent, userText, assistantText) {
  const fallbackContent = `用户：${clip(userText, 400)}\n助手：${clip(assistantText || '（本轮无文本回复）', 1400)}`
  const structured = await summarizeStructured(ctx, agent, userText, assistantText)
  const fallbackTitle = clip(userText.replace(/^\s*(用户|继续|好的|好)\s*[:：]?\s*/, ''), 24) || '对话记录'
  
  const type = structured ? structured.type : DEFAULT_TYPE
  const title = structured ? structured.title : fallbackTitle
  const content = structured ? structured.summary : fallbackContent
  const keywords = structured ? structured.keywords : []

  // Determine scope from the agent's session cwd (project) or user tier.
  let scope = 'user'
  let cwd
  try {
    const header = agent && agent.session ? agent.session.header : undefined
    if (header && typeof header.cwd === 'string' && header.cwd !== '') {
      scope = 'project'
      cwd = header.cwd
    }
  } catch (_e) { /* header unavailable */ }

  // Dedupe/merge: compare the incoming user request against stored auto user
  // lines, skipping pinned entries (pinned is never auto-merged).
  try {
    const existing = await memory.list({ tags: [type], limit: 200 })
    if (existing.length > 0) {
      const incomingUser = clip(userText, 400)
      let best = null
      let bestSim = 0
      for (const entry of existing) {
        if (entry.pinned) continue
        const sim = textSimilarity(incomingUser, userLineOf(entry))
        if (sim > bestSim) {
          bestSim = sim
          best = entry
        }
      }
      if (best && bestSim >= 0.55 && typeof best.id === 'string') {
        const tags = new Set(Array.isArray(best.tags) ? best.tags.map(String) : [])
        tags.add(type)
        tags.add('conversation')
        return await memory.save({
          id: best.id,
          content,
          tags: [...tags],
          title: title || best.title,
          keywords: keywords.length > 0 ? keywords : best.keywords,
          scope: best.scope ?? scope,
          cwd: best.cwd ?? cwd,
        })
      }
    }
  } catch (error) {
    console.error('[auto-memory] merge scan failed, appending instead:', error)
  }

  return await memory.save({
    content,
    tags: [type, 'conversation'],
    title,
    keywords,
    scope,
    cwd,
  })
}

// ─── Consolidation helpers (Memorax-inspired knowledge cards) ───────────────

const MIN_CANDIDATES = 12
const CHUNK_SIZE = 6
const ENTRY_MAX_CHARS = 80
const CONSOLIDATED_TAG = 'consolidated'
const CARD_TAG = 'card'

function logDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'memory')
}

function apt(line) {
  const text = `${new Date().toISOString()} ${line}\n`
  fs.mkdir(logDir(), { recursive: true }).catch(() => {})
    .then(() => fs.appendFile(join(logDir(), 'card-apt.txt'), text, 'utf8'))
    .catch(() => {})
}

/** Cluster a small batch of candidates into topic groups via LLM. */
async function clusterBatch(ctx, agent, batch) {
  const llm = ctx.get('llm')
  const provider = agent && agent.options && agent.options.provider
  const model = agent && agent.options && agent.options.model
  if (!llm || !provider || !model) return null
  try {
    const listing = batch.map((e, i) =>
      i + '. [' + (e.title || '无标题') + '] ' +
      String(e.content || '').replace(/\s+/g, ' ').trim().slice(0, ENTRY_MAX_CHARS)
    ).join('\n')
    const stream = llm.stream({
      provider, model,
      system: '你是知识整理助手。把下列记忆条目按主题聚类合并为知识卡片。只输出一个 JSON 对象，不要任何其他文本。格式：{"groups":[{"name":"不超过12字的主题名","summary":"合并后的1-3句中文要点，涵盖所有成员","memberIndexes":[整数索引数组]}]}。相似主题必须合并，不要为每个条目单独建组。',
      messages: [{
        role: 'user',
        id: `clust-${Date.now().toString(36)}`,
        source: { kind: 'user' },
        content: [{ type: 'text', text: listing }],
      }],
      temperature: 0.3,
      maxTokens: 500,
    })
    let text = ''
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'finish') break
    }
    apt(`cluster: in=${listing.length} out=${text.length}`)
    if (!text.trim()) return null
    const cleaned = text.replace(/```(json)?/gi, '').trim()
    const st = cleaned.indexOf('{')
    const en = cleaned.lastIndexOf('}')
    if (st === -1 || en <= st) return null
    const parsed = JSON.parse(cleaned.slice(st, en + 1))
    return Array.isArray(parsed.groups) ? parsed.groups : null
  } catch (error) {
    apt('cluster error: ' + (error && error.message ? error.message : String(error)))
    console.error('[auto-memory] cluster batch failed:', error)
    return null
  }
}

/** One consolidation pass: bucket by type+scope, chunk each bucket, cluster & write cards. */
async function consolidate(ctx, agent) {
  const memory = ctx.get('memory')
  if (!memory) { apt('consolidate: no memory'); return }
  const all = await memory.list({ limit: 500 })
  
  // Group by type (Memorax-inspired)
  const byType = {}
  for (const t of MEMORY_TYPES) byType[t] = []
  byType['mixed'] = []
  
  for (const e of all) {
    const tags = Array.isArray(e.tags) ? e.tags : []
    const type = MEMORY_TYPES.find(t => tags.includes(t)) || 'mixed'
    if (tags.includes('auto') && !e.pinned && 
        !tags.includes(CONSOLIDATED_TAG) && !tags.includes(CARD_TAG)) {
      byType[type].push(e)
    }
  }
  
  let totalCards = 0
  
  for (const [type, list] of Object.entries(byType)) {
    if (list.length < MIN_CANDIDATES) continue
    
    // Bucket by scope within type
    const buckets = { user: [], project: [], session: [] }
    for (const e of list) {
      const scope = e.scope === 'project' || e.scope === 'session' ? e.scope : 'user'
      buckets[scope].push(e)
    }
    
    for (const [scope, bucket] of Object.entries(buckets)) {
      if (bucket.length < 4) continue
      
      for (let off = 0; off < bucket.length; off += CHUNK_SIZE) {
        const chunk = bucket.slice(off, off + CHUNK_SIZE)
        const groups = await clusterBatch(ctx, agent, chunk)
        if (!groups) continue
        
        const idx = {}
        chunk.forEach((e, i) => { idx[i] = e })
        
        for (const g of groups) {
          const idxs = (Array.isArray(g.memberIndexes) ? g.memberIndexes : [])
            .map(n => Number(n)).filter(n => Number.isInteger(n) && idx[n])
          if (!idxs.length) continue
          
          const members = idxs.map(n => idx[n])
          const name = String(g.name || '卡').trim().slice(0, 24)
          const summary = String(g.summary || '').replace(/\s+/g, ' ').trim()
          if (!summary) continue
          
          const kw = new Set()
          members.forEach(m => (Array.isArray(m.keywords) || []).forEach(k => k && k.trim() && kw.add(k.trim())))
          
          try {
            await memory.save({
              content: summary,
              tags: ['auto', 'conversation', CARD_TAG, type],
              title: name,
              keywords: [...kw].slice(0, 6),
              scope,
            })
            for (const m of members) {
              await memory.save({
                id: m.id,
                content: m.content,
                tags: [...new Set([...(Array.isArray(m.tags) ? m.tags : []), CONSOLIDATED_TAG])],
                keywords: m.keywords,
                title: m.title,
                scope: m.scope,
                cwd: m.cwd,
              }).catch(() => {})
            }
            totalCards++
            apt(`card: [${type}] "${name}" members=${members.length}`)
          } catch (e) {
            apt('save error: ' + (e && e.message ? e.message : String(e)))
          }
        }
      }
    }
  }
  
  apt(`consolidate done: cards=${totalCards}`)
}

export const name = 'auto-memory'
export const inject = []

export function apply(ctx) {
  const recorded = new Map()
  const memoryOf = () => ctx.get('memory')

  ctx.on('agent/turn-stopping', (payload) => {
    const agent = payload && payload.agent
    const services = memoryOf()
    if (!agent || !agent.session || services === undefined) return

    const { userText, assistantText } = extractTurn(agent.session.events, payload.turn)
    if (userText === '') return // not a human-initiated round

    const key = String(agent.id)
    let turns = recorded.get(key)
    if (turns === undefined) {
      turns = new Set()
      recorded.set(key, turns)
    }
    if (turns.has(payload.turn)) return

    void recordTurn(ctx, services, agent, userText, assistantText)
      .then(() => turns.add(payload.turn))
      .catch((error) => console.error('[auto-memory] failed to record turn', payload.turn, error))
      .then(() => void consolidate(ctx, agent)) // fire-and-forget consolidation
  })
}

export default { name, inject, apply }

