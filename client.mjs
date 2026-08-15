// client.mjs — Standard Cordis client plugin entry for dsh-memory-plugin.
//
// When installed as a proper npm package and built, this file becomes
// the client bundle served at /plugins/dsh-memory-plugin/client.js.
//
// If you just want to use the memory panel right now via dynamic Plugin,
// follow memui.install.md (run cordis_define + cordis_run). This file is
// the standard-cordis counterpart for integration into the shipped build
// pipeline (pnpm run dev:web) — in which case client-side RPC must go
// through the connection service (see dsh-client-connection), not host.call.
//
// Export shape is the standard Cordis client plugin contract:
//   export const name
//   export const inject
//   export function apply(ctx)

export const name = 'memory-panel'
export const inject = ['slots', 'locale']

export function apply(ctx) {
  const slots = ctx.get('slots')
  const locale = ctx.get('locale')
  if (!slots) {
    console.warn('[memory-panel] slots service unavailable')
    return
  }

  const t = locale ? locale.bind('memory-panel') : (key, fallback) => fallback || key
  const PLURAL = {
    coding: '工程经验',
    repo: '仓库知识',
    personal: '个人偏好',
    procedure: '流程记忆',
    card: '知识卡片',
    auto: '自动记录',
    'user-preference': '偏好',
    conversation: '会话',
    other: '其他',
  }

  function typeOf(tags) {
    const order = ['coding', 'repo', 'personal', 'procedure', 'card', 'auto', 'user-preference', 'conversation']
    for (const x of order) {
      if (tags.indexOf(x) !== -1) return x
    }
    return 'other'
  }

  // Standard React component using hooks — compatible with the shipped
  // React runtime in DSH. No JSX: use React.createElement directly.
  // NOTE: the actual RPC to fetch/pin/forget memories requires
  // connecting through `ctx.get('api-remotes')` / `dsh-client-connection`.
  // This stub renders a placeholder panel and registers the slot.
  function MemoryPanel() {
    const React = ctx.React
    const [loading, setLoading] = React.useState(true)
    const [msg, setMsg] = React.useState('请在动态插件方式下启用（运行 memui 插件）')

    return React.createElement('div', { style: { padding: '20px', fontSize: '14px' } },
      React.createElement('h3', null, '记忆库'),
      React.createElement('p', null, '当前以标准插件方式加载时，记忆面板通过动态插件方式提供（memui）。请运行以下命令重新加载面板：'),
      React.createElement('pre', { style: { background: 'var(--dsh-bg-secondary)', padding: '10px', borderRadius: '6px' } },
        '在对话中执行:\n' +
        '  cordis_define → memui\n' +
        '  cordis_run memui/pkg-N run'
      ),
      React.createElement('p', null, msg)
    )
  }

  slots.inject('settings.section', () =>
    slots.register(
      { name: 'settings.section', id: 'memory', order: 25, label: '记忆' },
      () => React.createElement(MemoryPanel, null)
    )
  )

  console.log('[memory-panel] settings.section registered (stub: use dynamic plugin memui for full features)')
}

export default { name, inject, apply }
