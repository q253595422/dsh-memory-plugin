# DSH Memory Plugin

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的**跨会话持久记忆插件**，通过 Cordis 宿主行（host-plane）实现记忆的全生命周期管理：自动记录、分层存储、结构化摘要、语义检索、知识卡片聚类，以及可视化记忆面板。

## ✨ 功能特性

| # | 功能 | 实现 |
|---|------|------|
| ① | **会话标题** | LLM 结构化摘要，自动生成标题 |
| ② | **记忆分层 + 类型分类** | `user` / `project`（按 cwd 自动识别）/ `session` 三层；按 Memorax Code 四类 Memory 自动分类：`coding` / `repo` / `personal` / `procedure` |
| ③ | **固定重要记忆** | pin / unpin，置顶优先展示，免合并、免卡片整理 |
| ④ | **记忆自动注入** | systemPrompt section（order 95），每条模型请求自动带记忆快照，15s 刷新 |
| ⑤ | **知识卡片** | 同类 ≥12 条候选自动 LLM 聚类合并（分桶 6 条/批） |
| ⑥ | **语义搜索** | 关键词加权 relevance search（纯 JS，无 embedding 依赖） |
| ⑦ | **记忆设置页** | 「记忆编辑器」设置页：搜索 / 固定 / 删除 / 编辑 / 新增 |

## 🏗 架构

```
宿主层 (HOST, cordis.patch.yml)          Agent 工具层 (preset / memtools)
┌────────────────────────────────┐       ┌──────────────────────────┐
│ memory-host (memhost3.mjs)     │       │ tool-memory (memtools2)  │
│  - MemoryService (ctx.memory)  │       │  memory_save             │
│  - JSON 文件存储               │       │  memory_search           │
│  - keyword 索引 relevance 搜索 │       │  memory_list             │
│  - pin/unpin / per-scope 过滤  │       │  memory_pin              │
├────────────────────────────────┤       │  memory_forget           │
│ auto-memory5.mjs               │       │  memory_info             │
│  - turn-stopping 监听          │       └──────────────────────────┘
│  - LLM 结构化摘要              │       ┌──────────────────────────┐
│  - 四类 Memory 自动分类        │       │ 记忆设置页 UI            │
│  - bigram 去重合并             │       │  (memui 动态插件)        │
│  - scope 自动识别              │       │  - 列表/搜索/固定/删除   │
│  - consolidation 知识卡片      │       │  - 编辑/新增             │
├────────────────────────────────┤       └──────────────────────────┘
│ memory-inject2.mjs             │
│  - systemPrompt section (95)   │
│  - 15s 定时刷新 + turn 刷新    │
└────────────────────────────────┘
```

记忆数据统一存放在：`$DSH_HOME/memory/memories.json`（默认 `~/.dsh/memory/memories.json`）。

## 📦 安装

### 1. 复制插件文件

把本仓库的 `.mjs` 文件复制到你的 profile 目录，例如：

```
$DSH_HOME/profiles/web/memory-plugin/
```

（`$DSH_HOME` 默认是 `~/.dsh`）

### 2. 配置 patch 层

把 [cordis.patch.yml](./cordis.patch.yml) 中的内容合并到你的 profile patch，例如
`$DSH_HOME/profiles/web/cordis.patch.yml`。它注册 4 个宿主行：

| id | 文件 | 作用 |
|----|------|------|
| `memory-host` | memhost3.mjs | 发布 `memory` 服务（必须最先加载） |
| `auto-memory` | auto-memory5.mjs | 每轮对话自动记忆 |
| `memory-inject` | memory-inject2.mjs | 记忆注入模型提示词 |
| `tool-memory` | memtools2.mjs | 注册 memory_* 六个模型工具 |

### 3. （可选）记忆设置页 UI

「记忆编辑器」设置页是一个**动态 Cordis Plugin**（需要浏览器授权），按
[memui.install.md](./memui.install.md) 的步骤加载 `memui.host.mjs` +
`memui.client.mjs` 模板，然后在左下角 ⚙️ 设置 → 「记忆编辑器」使用。

> 注意：如果部署自带官方 `ui-memory` 客户端面板，为避免设置页出现两个
> 「记忆」入口，可按 id 禁用官方那一行（详见 cordis.patch.yml 注释）。

### 4. （可选）独立 3081 网页面板

```bash
node memory-server.mjs   # 启动后打开 http://localhost:3081
```

## 🧰 可用工具

| 工具 | 说明 |
|------|------|
| `memory_save` | 保存一条记忆（可带 title/keywords/scope/pinned） |
| `memory_search` | 关键词加权语义搜索 |
| `memory_list` | 列出记忆（可按 scope/limit 过滤） |
| `memory_pin` | 固定 / 取消固定 |
| `memory_forget` | 删除记忆 |
| `memory_info` | 统计信息（总条数 / 分层 / 置顶等） |

## 🔧 配置

全部通过 `cordis.patch.yml` 完成，无需额外配置文件。默认行为可改：

- 记忆文件位置：`memhost3.mjs` / `memory-server.mjs` 中的 `$DSH_HOME/memory/`
- 注入顺序：`memory-inject2.mjs` 中的 `order: 95`
- 自动记忆开关：`auto-memory5.mjs` 中按 `agent/turn-stopping` 事件触发

## 📄 License

MIT