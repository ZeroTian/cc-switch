# Workspaces 设计文档

**日期**：2026-05-01
**状态**：待实现

## 需求概述

用户希望给不同的项目目录绑定不同的 Skill 分组组合，点击"应用"后将对应 Skill 同步到该目录下的局部配置（`<path>/.claude/skills/`），实现不同工作空间使用不同技能配置。

## 核心决策

| 问题 | 决策 |
|------|------|
| 触发方式 | 手动点击"应用"按钮 |
| 应用效果 | 在目录下创建局部 `.claude/skills/` + cc-switch 标记 |
| 清除旧配置 | 不自动清除，各目录局部配置独立共存 |
| 数据存储 | cc-switch 数据库（可随 WebDAV 同步） |
| 分组绑定数量 | 一个工作空间可绑定多个分组（取并集） |

## 数据层

### 新增两张表（schema v13→v14）

```sql
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE workspace_groups (
    workspace_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    PRIMARY KEY (workspace_id, group_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES skill_groups(id) ON DELETE CASCADE
);
```

### apply_workspace 逻辑

1. 读取工作空间所有绑定分组
2. 对每个分组取成员 skill 列表，去重合并（取并集）
3. 确保 `<path>/.claude/skills/` 目录存在
4. 对每个 skill 按所属分组的 app 开关，在该目录下创建 symlink
   - 若 symlink 已存在则跳过（不覆盖）
   - 若目标 SSOT 文件不存在则跳过并记录警告
5. 返回成功同步的 skill 数量和失败列表

**不影响：**
- 全局 `~/.claude/skills/`
- 数据库 `enabled_*` 字段
- 现有分组激活/快照逻辑

## 后端命令层

新增文件：`src-tauri/src/commands/workspace_skill.rs`

```
get_workspaces()                               → Vec<Workspace>
create_workspace(name, path)                   → Workspace
update_workspace(id, name, path)               → Workspace
delete_workspace(id)                           → ()
add_group_to_workspace(workspace_id, group_id) → ()
remove_group_from_workspace(workspace_id, group_id) → ()
get_workspace_group_ids(workspace_id)          → Vec<String>
apply_workspace(workspace_id)                  → ApplyResult { synced: usize, failed: Vec<String> }
```

同步新增：
- `src-tauri/src/database/dao/workspaces.rs` — DAO 层
- `src-tauri/src/services/workspace_skill.rs` — 业务逻辑层

## 前端 UI

### Skills 页新增第三个 tab "工作空间"

```
[已安装] [分组] [工作空间]
```

### 工作空间列表页（`WorkspacesPanel.tsx`）

- 每条显示：名称、目录路径（截断显示）、已绑定分组数量
- 操作：**应用**（主要操作）/ 编辑 / 删除
- 右上角"新建工作空间"按钮（outline 风格）
- 应用后 toast："已同步 N 个 Skill 到 `<path>/.claude/skills/`"

### 新建/编辑弹窗（`WorkspaceEditDialog.tsx`）

- 名称输入框
- 目录路径输入框 + "浏览"按钮（调用 `pick_directory` 命令，复用已有逻辑）
- 分组多选列表（从现有分组勾选，支持搜索过滤）

## 文件变更清单

### 新增
- `src-tauri/src/database/dao/workspaces.rs`
- `src-tauri/src/services/workspace_skill.rs`
- `src-tauri/src/commands/workspace_skill.rs`
- `src/lib/api/workspaces.ts`
- `src/hooks/useWorkspaces.ts`
- `src/components/skills/WorkspacesPanel.tsx`
- `src/components/skills/WorkspaceEditDialog.tsx`

### 修改
- `src-tauri/src/database/schema.rs` — 新增两张表 + v13→v14 migration
- `src-tauri/src/database/mod.rs` — SCHEMA_VERSION = 14
- `src-tauri/src/database/dao/mod.rs` — 注册新 DAO
- `src-tauri/src/services/mod.rs` — 导出新服务
- `src-tauri/src/commands/mod.rs` — 注册新命令模块
- `src-tauri/src/lib.rs` — invoke_handler 添加新命令
- `src/components/skills/UnifiedSkillsPanel.tsx` — 新增"工作空间"tab

## 不在本次范围内

- 自动检测当前目录并切换工作空间
- 工作空间应用状态的持久化追踪（是否已应用、最后应用时间）
- 移除/回滚工作空间 skills（只添加不删除）
