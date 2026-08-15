// memui.client.mjs — Client half of the memory panel dynamic plugin.
//
// Load via cordis_define (dynamic Plugin), NOT via cordis.patch.yml.
// See memui.install.md.
//
// This half registers a "记忆" page in the DSH settings panel
// (settings.section slot) and talks to the Host half over host.call.

// code.client body (serialized into the Plugin definition):
function typeOf(tags) {
  const order = ['coding', 'repo', 'personal', 'procedure', 'card', 'auto', 'user-preference', 'conversation']
  for (let i = 0; i < order.length; i++) {
    if (tags.indexOf(order[i]) !== -1) return order[i]
  }
  return 'other'
}
const TYPE_LABELS = {
  coding: '工程经验', repo: '仓库知识', personal: '个人偏好', procedure: '流程记忆',
  card: '知识卡片', auto: '自动记录', 'user-preference': '偏好', conversation: '会话', other: '其他',
}
const wrap = { padding: '16px 20px', fontSize: '14px' }
const row = { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }
const input = { width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--dsh-border, #d0d7de)', marginBottom: '12px', fontSize: '14px', boxSizing: 'border-box' }
const btn = { padding: '4px 12px', borderRadius: '6px', border: '1px solid var(--dsh-border, #d0d7de)', background: 'transparent', cursor: 'pointer', fontSize: '13px' }
const chip = { padding: '3px 10px', borderRadius: '12px', background: 'var(--dsh-bg-tertiary, #f0f0f0)', fontSize: '12px', color: 'var(--dsh-text-secondary, #666)' }
const cardBase = { padding: '10px 12px', border: '1px solid var(--dsh-border, #e5e7eb)', borderRadius: '8px', marginBottom: '8px', background: 'var(--dsh-bg-primary, #fff)' }
const errText = { color: '#d33', fontSize: '13px', marginBottom: '8px' }
const empty = { color: 'var(--dsh-text-tertiary, #999)', textAlign: 'center', padding: '32px 0' }
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (!slots) return
    function MemoryPanel() {
      const [query, setQuery] = React.useState('')
      const [entries, setEntries] = React.useState([])
      const [loading, setLoading] = React.useState(true)
      const [msg, setMsg] = React.useState('')
      async function load(q) {
        try {
          setLoading(true)
          const res = await host.call('mem.list', { query: q || '', limit: 500 })
          setEntries((res && res.entries) || [])
          setMsg('')
        } catch (e) {
          setMsg('加载失败: ' + (e && e.message ? e.message : String(e)))
        } finally {
          setLoading(false)
        }
      }
      React.useEffect(function () { load('') }, [])
      async function doPin(id, pinned) {
        const res = await host.call('mem.pin', { id: id, pinned: pinned })
        if (res && res.ok) {
          setEntries(function (es) { return es.map(function (x) { return x.id === id ? Object.assign({}, x, { pinned: pinned }) : x }) })
        } else {
          setMsg((res && res.error) || '操作失败')
        }
      }
      async function doForget(id) {
        const res = await host.call('mem.forget', { id: id })
        if (res && res.ok) {
          setEntries(function (es) { return es.filter(function (x) { return x.id !== id }) })
        } else {
          setMsg((res && res.error) || '删除失败')
        }
      }
      const q = query.trim().toLowerCase()
      const filtered = entries.filter(function (e) {
        if (!q) return true
        return (e.title || '').toLowerCase().indexOf(q) !== -1 ||
          (e.content || '').toLowerCase().indexOf(q) !== -1 ||
          e.tags.some(function (t) { return t.toLowerCase().indexOf(q) !== -1 })
      })
      const stats = {}
      filtered.forEach(function (e) {
        const t = typeOf(e.tags)
        stats[t] = (stats[t] || 0) + 1
      })
      const sorted = filtered.slice().sort(function (a, b) {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
      })
      const chips = Object.keys(stats).map(function (t) {
        return React.createElement('span', { key: t, style: chip }, TYPE_LABELS[t] + ': ' + stats[t])
      })
      return React.createElement('div', { style: wrap },
        React.createElement('div', { style: row },
          React.createElement('strong', null, '记忆库 (' + entries.length + ')'),
          React.createElement('button', { onClick: function () { load(query) }, style: btn }, '刷新')
        ),
        React.createElement('input', {
          placeholder: '搜索记忆...', value: query,
          onChange: function (e) { setQuery(e.target.value) }, style: input,
        }),
        React.createElement('div', { style: row }, chips),
        msg ? React.createElement('div', { style: errText }, msg) : null,
        loading ? React.createElement('div', null, '加载中...') :
          filtered.length === 0 ? React.createElement('div', { style: empty }, '暂无记忆，多和团团聊聊天就会自动记录~') :
            sorted.map(function (e) {
              const tags = e.tags.length ? e.tags.join(' · ') : ''
              const scopeMark = e.scope ? ' [' + e.scope + ']' : ''
              return React.createElement('div', { key: e.id, style: cardBase },
                React.createElement('div', { style: row },
                  React.createElement('strong', null, (e.pinned ? '📌 ' : '') + (e.title || '无标题')),
                  React.createElement('span', { style: { flex: 1 } }),
                  React.createElement('button', { onClick: function () { doPin(e.id, !e.pinned) }, style: btn }, e.pinned ? '取消固定' : '固定'),
                  React.createElement('button', { onClick: function () { doForget(e.id) }, style: Object.assign({}, btn, { color: '#d33' }) }, '删除')
                ),
                React.createElement('div', { style: { fontSize: '13px', color: 'var(--dsh-text-secondary, #555)', margin: '4px 0' } },
                  String(e.content || '').slice(0, 200)
                ),
                React.createElement('div', { style: { fontSize: '11px', color: 'var(--dsh-text-tertiary, #999)' } }, tags + scopeMark)
              )
            })
      )
    }
    slots.inject('settings.section', function () {
      return slots.register(
        { name: 'settings.section', id: 'memory', order: 25, label: '记忆' },
        function () { return React.createElement(MemoryPanel, null) }
      )
    })
    console.log('[memui] 记忆 settings page registered')
  },
}