# 记忆管理面板安装说明 (memui)

「记忆」设置页面是一个 **动态 Cordis Plugin**（需要浏览器授权），
不能像 memhost3/auto-memory5 那样直接写进 `cordis.patch.yml`。

## 为什么是动态插件

- 动态插件在当前 DSH 进程中运行，代码由模型会话通过 `cordis_define`
  注入，首次运行需要你在界面点击授权。
- 进程重启后动态插件会丢失，需要重新定义（这正是本说明存在的原因）。

## 安装步骤

在 DSH 会话里让助手执行：

1. `cordis_define`（kind: new, idPrefix: `memui`）双端代码：
   - `code.host` ← `memui.host.mjs` 中 `return { ... }` 的内容
   - `code.client` ← `memui.client.mjs` 中 `return { ... }` 的内容
2. `cordis_run` 激活返回的 `pluginId/packageId`（首次运行需要你批准）。
3. 刷新页面 → 左下角 ⚙️ 设置 → 「记忆」标签。

## 功能

| 功能 | 说明 |
|---|---|
| 列表 | 全部记忆，📌 固定条目置顶，按更新时间排序 |
| 搜索 | 按标题 / 内容 / 标签实时过滤 |
| 类型统计 | 工程经验 / 仓库知识 / 个人偏好 / 流程记忆 / 知识卡片 / 自动记录 |
| 固定 | 📌 重要记忆 固定/取消固定 |
| 删除 | 移除不需要的记忆 |

## 依赖

- Host: `memory` 服务（由 `memhost3.mjs` 发布）
- RPC 方法: `mem.list` / `mem.pin` / `mem.forget`