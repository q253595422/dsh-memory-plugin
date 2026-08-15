// memui-client.mjs — Client plugin for memory management panel
// Registers a '记忆' section in DSH settings

export const name = 'memui-client'
export const inject = []

export function apply(ctx) {
  const slots = ctx.get('slots')
  if (!slots) {
    console.warn('[memui-client] slots service not available')
    return
  }

  // Register the settings section
  slots.inject('settings.section', () => {
    return slots.register(
      {
        name: 'settings.section',
        id: 'memory',
        order: 25,
        label: '记忆'
      },
      () => {
        // React component for the memory panel
        const React = ctx.React
        const [entries, setEntries] = React.useState([])
        const [query, setQuery] = React.useState('')
        const [loading, setLoading] = React.useState(true)

        React.useEffect(() => {
          // Load memories from the host service
          loadMemories()
        }, [])

        async function loadMemories() {
          try {
            // Access the memory service via globalThis (set by memui.mjs host plugin)
            const handlers = globalThis.__memui_handlers
            if (handlers && handlers.list) {
              const result = await handlers.list({ query: '', limit: 500 })
              setEntries(result.entries || [])
            }
            setLoading(false)
          } catch (err) {
            console.error('[memui-client] Failed to load memories:', err)
            setLoading(false)
          }
        }

        async function togglePin(id, pinned) {
          try {
            const handlers = globalThis.__memui_handlers
            if (handlers && handlers.pin) {
              await handlers.pin({ id, pinned })
              await loadMemories()
            }
          } catch (err) {
            console.error('[memui-client] Failed to toggle pin:', err)
          }
        }

        async function deleteMemory(id) {
          if (!confirm('确定要删除这条记忆吗？')) return
          try {
            const handlers = globalThis.__memui_handlers
            if (handlers && handlers.forget) {
              await handlers.forget({ id })
              await loadMemories()
            }
          } catch (err) {
            console.error('[memui-client] Failed to delete:', err)
          }
        }

        const TYPE_LABELS = {
          coding: '工程经验', repo: '仓库知识', personal: '个人偏好',
          procedure: '流程记忆', card: '知识卡片', auto: '自动记录',
          'user-preference': '偏好', conversation: '会话', other: '其他'
        }

        function typeOf(tags) {
          const order = ['coding', 'repo', 'personal', 'procedure', 'card', 'auto', 'user-preference', 'conversation']
          for (const t of order) {
            if (tags.includes(t)) return t
          }
          return 'other'
        }

        const filtered = entries.filter(e => {
          if (!query) return true
          const q = query.toLowerCase()
          return (e.title || '').toLowerCase().includes(q) ||
                 (e.content || '').toLowerCase().includes(q) ||
                 (e.tags || []).some(t => t.toLowerCase().includes(q))
        })

        const stats = {}
        filtered.forEach(e => {
          const type = typeOf(e.tags || [])
          stats[type] = (stats[type] || 0) + 1
        })

        return React.createElement('div', { style: { padding: '20px' } },
          React.createElement('h3', { style: { marginBottom: '16px' } }, `记忆库 (${entries.length})`),
          React.createElement('button', {
            onClick: loadMemories,
            style: {
              padding: '8px 16px',
              background: '#4a90e2',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              marginBottom: '16px'
            }
          }, '刷新'),
          React.createElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' } },
            Object.entries(stats).map(([type, count]) =>
              React.createElement('span', {
                key: type,
                style: {
                  padding: '4px 12px',
                  background: '#f0f0f0',
                  borderRadius: '12px',
                  fontSize: '12px'
                }
              }, `${TYPE_LABELS[type] || type}: ${count}`)
            )
          ),
          React.createElement('input', {
            type: 'text',
            placeholder: '搜索记忆...',
            value: query,
            onChange: (e) => setQuery(e.target.value),
            style: {
              width: '100%',
              padding: '10px 14px',
              border: '1px solid #ddd',
              borderRadius: '8px',
              marginBottom: '16px',
              fontSize: '14px'
            }
          }),
          loading
            ? React.createElement('div', { style: { textAlign: 'center', padding: '40px', color: '#666' } }, '加载中...')
            : filtered.length === 0
              ? React.createElement('div', { style: { textAlign: 'center', padding: '60px', color: '#999' } }, '暂无记忆，多和团团聊聊天就会自动记录~')
              : React.createElement('div', null,
                  filtered.map(e =>
                    React.createElement('div', {
                      key: e.id,
                      style: {
                        padding: '14px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        marginBottom: '10px',
                        background: '#fff',
                        borderLeft: e.pinned ? '3px solid #f39c12' : '1px solid #e5e7eb'
                      }
                    },
                      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } },
                        React.createElement('strong', { style: { flex: 1 } }, (e.pinned ? '📌 ' : '') + (e.title || '无标题')),
                        React.createElement('button', {
                          onClick: () => togglePin(e.id, !e.pinned),
                          style: {
                            padding: '4px 12px',
                            border: '1px solid #f39c12',
                            background: 'transparent',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px',
                            color: '#f39c12'
                          }
                        }, e.pinned ? '取消固定' : '固定'),
                        React.createElement('button', {
                          onClick: () => deleteMemory(e.id),
                          style: {
                            padding: '4px 12px',
                            border: '1px solid #e74c3c',
                            background: 'transparent',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px',
                            color: '#e74c3c'
                          }
                        }, '删除')
                      ),
                      React.createElement('div', {
                        style: { fontSize: '13px', color: '#666', marginBottom: '8px', lineHeight: '1.5' }
                      }, (e.content || '').slice(0, 200)),
                      React.createElement('div', {
                        style: { fontSize: '11px', color: '#999' }
                      }, (e.tags || []).map(t => TYPE_LABELS[t] || t).join(' · '))
                    )
                  )
                )
        )
      }
    )
  })

  console.log('[memui-client] settings section registered')
}

export default { name, inject, apply }
