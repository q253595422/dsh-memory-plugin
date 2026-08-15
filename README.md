# DSH Memory Plugin

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的跨会话持久记忆系统，通过 Cordis 宿主行（host-plane）实现六项能力升级。

## 功能特性

| # | 功能 | 实现 |
|---|---|---|
| ③ | **会话标题** | LLM 结构化摘要，自动生成 12 字内中文标题 |
| ② | **记忆分层** | `user` / `project`（自动识别 cwd）/ `session` |
| ④ | **固定重要记忆** | pin/unpin，免合并、免卡片整理 |
| ① | **记忆自动注入** | systemPrompt section（order 95），每 15s 刷新 |
| ⑥ | **知识卡片** | ≥12 条候选自动 LLM 聚类合并（分批 6 条/批） |
| ⑤ | **语义搜索** | 关键词加权 relevance search（无 embedding） |

## 架构

```
宿主行 (HOST, cordis.patch.yml)          Agent 工具层 (preset)
┌─────────────────────────┐              ┌─────────────────────┐
│ memory-host (memhost3)  │◄──────┐      │ tool-memory         │
│   - MemoryService       │       │      │   memory_save       │
│   - JSON 文件存储        │       │      │   memory_search     │
│   - keyword 索引搜索    │       │      │   memory_forget     │
└─────────────────────────┘       │      │   memory_pin        │
┌─────────────────────────┐       │      │   memory_info       │
│ auto-memory4            │◄──────┘      │   memory_list       │
│   - turn-stopping 监听   │              └─────────────────────┘
│   - LLM 结构化摘要      │
│   - bigram 去重合并     │
│   - scope 自动识别      │
│   - consolidation 卡片  │
└─────────────────────────┘
┌─────────────────────────┐
│ memory-inject2          │
│   - systemPrompt section│
│   - pinned 优先展示     │
│   - 15s 定时刷新        │
└─────────────────────────┘
```

## 安装

### 1. 复制宿主行文件到你的 profile

```powershell
$PROFILE = "$env:USERPROFILE\.dsh\profiles\web"
Copy-Item memhost3.mjs auto-memory4.mjs memory-inject2.mjs -Destination $PROFILE
```

### 2. 追加 patch 配置到 `cordis.patch.yml`

```yaml
# memory-host: shared memory service (HOST row)
- insert:
    - id: memory-host
      name: './memhost3.mjs'

# auto-memory: turn-stopping listener + consolidation (HOST row)
- insert:
    - id: auto-memory
      name: './auto-memory4.mjs'

# memory-inject: systemPrompt injection (HOST row)
- insert:
    - id: memory-inject
      name: './memory-inject2.mjs'
```

> 注意顺序：`memory-host` 必须在其他两行之前（确保 memory 服务先可用）。

### 3. （可选）Agent 工具层

在 `.agent-presets/<your-preset>/agent.cordis.yml` 追加：

```yaml
- id: tool-memory
  name: './memtools2.mjs'
```

## 工作原理

### 自动记忆 (`auto-memory4.mjs`)

1. 监听 `agent/turn-stopping` 事件
2. 提取本轮 `userText` + `assistantText`
3. 调用 LLM 结构化摘要（`{title, summary, keywords}`）
4. Bigram Jaccard 相似度去重（阈值 ≥0.55）
5. 写入 `memory` 服务（scope 由 session.cwd 自动推导）
6. 若 unconsolidated auto 条目 ≥12，触发 scope-bucketed 聚类

### 知识卡片聚类 (`consolidate`)

- **分桶**：按 scope（user/project/session）分组
- **分批**：每批最多 6 条 × 80 字截断（避免 LLM 长输入失败）
- **聚类**：LLM 按主题分组 → 合并为卡片（`card` 标签）
- **标记**：成员打 `consolidated` 标签（保留原文，免重复处理）
- **fire-and-forget**：不阻塞回合关闭

### 记忆注入 (`memory-inject2.mjs`)

- 注册 `systemPrompt.section(name='memory:recall', order=95)`
- 展示顺序：pinned 条目优先（⭐），其次最新 6 条 auto 摘要
- 刷新策略：15s 定时（无条件）+ turn-stopping 即时刷新

### 存储服务 (`memhost3.mjs`)

- 存储：单 JSON 文件 `$DSH_HOME/memory/memories.json`
- 写入：promise-chain 串行化（防并发冲突）
- 搜索：content 命中 (+4) + keyword 命中 (+5) + pinned (+2) + 时间衰减
- 清理：`clean()` 剔除 `undefined` 值键（lossless JSON）

## 技术约束

- **无 `#private` 字段**：Cordis Service `Object.create(this)` 包装不支持 JS private fields，全部用 `_` 前缀
- **ESM 缓存**：改 `.mjs` 内容必须换文件名 + 新 URL 才能热生效
- **宿主行 vs preset**：`memory` 服务是宿主行（跨会话共享），工具层是 preset（单会话）
- **HMR 兼容**：patch 文件修改自动热重载，无需重启宿主

## 文件说明

| 文件 | 大小 | 用途 |
|---|---|---|
| `memhost3.mjs` | ~12KB | 宿主 memory 服务（save/search/list/forget/pin/stats） |
| `auto-memory4.mjs` | ~14KB | 自动记忆 + consolidation（turn-stopping 监听） |
| `memory-inject2.mjs` | ~3KB | systemPrompt 注入（15s 刷新） |
| `memtools2.mjs` | ~8KB | Agent 工具层（6 个 memory 工具） |
| `cordis.patch.yml` | ~400B | 宿主 patch 配置示例 |
| `README.md` | ~3KB | 本文档 |

## License

MIT — 欢迎 fork 和改进！
