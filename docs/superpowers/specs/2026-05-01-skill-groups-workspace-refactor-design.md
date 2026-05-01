# Skill Groups & Workspace 重构设计文档

**日期**：2026-05-01
**状态**：待实现

## 需求概述

1. **分组支持多选激活**：多个分组同时激活，取成员 skill 并集同步到全局 `~/.claude/skills/`
2. **移除快照机制**：不再需要"激活前保存、停用时恢复"，toggle_skill_app 也不再清除分组状态
3. **工作空间即时同步**：勾选工作空间分组即触发同步，状态持久化，无需"应用"按钮
4. **成员变化自动同步**：分组增减 skill 时，自动重新同步到已激活的全局配置和绑定的工作空间

## 核心决策

| 问题 | 决策 |
|------|------|
| 多激活语义 | `skill_groups.is_active` 允许多个同时为 true，改激活逻辑而不改字段 |
| 快照 | 移除 `skill_group_snapshot` 表和所有相关逻辑 |
| 工作空间激活记录 | 新增 `workspace_group_active` 表记录每个工作空间激活了哪些分组 |
| 触发方式 | 服务层内部自动触发，前端无感知 |

---

## 数据层变更（schema v15→v16）

### 移除
- `skill_group_snapshot` 表（DROP TABLE）

### 新增
```sql
workspace_group_active (
  workspace_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, group_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES skill_groups(id) ON DELETE CASCADE
)
```

### 修改
- `set_skill_group_active(id, active)` — 只设置单个分组的 `is_active`，**不再**先将所有分组置 0
- 新增 `toggle_workspace_group_active(workspace_id, group_id, active)` — 管理 workspace_group_active 表
- 新增 `get_workspace_active_group_ids(workspace_id)` — 查询工作空间已激活的分组

---

## 服务层变更

### 移除
- `SkillGroupService::activate` 中的快照保存逻辑
- `SkillGroupService::deactivate_all` 中的快照恢复逻辑
- `SkillService::disable_all_skills_with_db`
- `SkillService::enable_skills_by_ids_for_apps_with_db`
- `SkillService::sync_to_app_dir_pub`
- `database/dao/skills.rs` 中的三个快照方法

### 新增两个核心同步函数

**`SkillGroupService::sync_active_groups_to_global(db)`**
1. 查询所有 `is_active=1` 的分组
2. 收集所有成员 skill 的并集（HashSet 去重）
3. 清空 `~/.claude/skills/` 中现有 symlink（只清 cc-switch 管理的部分）
4. 按每个 skill 自身的 per-app 开关重新 symlink 到对应 app 目录
5. 更新数据库 `enabled_*` 字段

**`WorkspaceSkillService::sync_active_groups_to_workspace(db, workspace_id)`**
1. 查询该工作空间 `workspace_group_active` 中的分组
2. 收集成员 skill 并集
3. 清空 `<path>/.claude/skills/` 中现有 symlink
4. 重新 symlink（不修改数据库 `enabled_*`）

### 自动触发规则

| 操作 | 触发同步 |
|------|---------|
| 激活分组（全局） | `sync_active_groups_to_global` |
| 停用分组（全局） | `sync_active_groups_to_global` |
| 勾选工作空间分组 | `sync_active_groups_to_workspace(workspace_id)` |
| 取消工作空间分组 | `sync_active_groups_to_workspace(workspace_id)` |
| `add_skill_to_group(group_id)` | 若该分组全局已激活 → `sync_active_groups_to_global`；遍历所有绑定该分组的工作空间 → `sync_active_groups_to_workspace` |
| `remove_skill_from_group(group_id)` | 同上 |
| `toggle_skill_app` | 不触发分组同步，只执行 per-app toggle |

---

## 命令层变更

### 移除
- `activate_skill_group`、`deactivate_all_skill_groups`（替换为 `set_group_active`）
- `apply_workspace`（替换为 `toggle_group_in_workspace`）

### 新增/修改
```
set_group_active(group_id, active: bool)  → 设置全局激活状态，触发 sync_active_groups_to_global
toggle_group_in_workspace(workspace_id, group_id, active: bool) → 管理 workspace_group_active，触发同步
get_workspace_active_group_ids(workspace_id) → Vec<String>
```

---

## 前端 UI 变更

### 分组面板（SkillGroupsPanel）

- **激活/停用按钮 → Checkbox**：勾选即激活，取消勾选即停用，支持多选
- 移除激活/停用按钮（Play/Pause icon）
- 分组卡片激活样式保持不变（蓝色边框 + 蓝色文字）
- UnifiedSkillsPanel 激活提示条改为：`当前激活：N 个分组`（N > 0 时显示）

### 工作空间面板（WorkspacesPanel）

- 每个工作空间卡片支持展开/折叠（点击卡片行展开）
- 展开后显示所有分组的勾选列表
- 勾选分组 = 绑定到工作空间 + 激活（`toggle_group_in_workspace(active=true)`）
- 取消勾选 = 取消激活（`toggle_group_in_workspace(active=false)`），也同时从 `workspace_groups` 移除
- 移除独立"应用"按钮
- 展开区域展示当前目录路径和已激活分组数量

### 新增 hooks
- `useSetGroupActive` — 替换 `useActivateSkillGroup` / `useDeactivateAllSkillGroups`
- `useToggleGroupInWorkspace` — 替换 `useApplyWorkspace`
- `useWorkspaceActiveGroupIds(workspaceId)` — 查询工作空间已激活分组

---

## 文件变更清单

### Rust 后端
- `src-tauri/src/database/schema.rs` — DROP snapshot, ADD workspace_group_active, v15→v16
- `src-tauri/src/database/mod.rs` — SCHEMA_VERSION = 16
- `src-tauri/src/database/dao/skill_groups.rs` — 修改 set_skill_group_active
- `src-tauri/src/database/dao/workspaces.rs` — 新增 toggle/get workspace_group_active 方法
- `src-tauri/src/database/dao/skills.rs` — 移除三个快照方法
- `src-tauri/src/services/skill_group.rs` — 移除快照逻辑，新增 sync_active_groups_to_global
- `src-tauri/src/services/workspace_skill.rs` — 新增 sync_active_groups_to_workspace，修改触发逻辑
- `src-tauri/src/services/skill.rs` — 移除三个 _with_db 方法
- `src-tauri/src/commands/skill_group.rs` — 移除 activate/deactivate_all，新增 set_group_active
- `src-tauri/src/commands/workspace_skill.rs` — 移除 apply_workspace，新增 toggle_group_in_workspace 和 get_workspace_active_group_ids
- `src-tauri/src/lib.rs` — 更新 invoke_handler 注册

### 前端
- `src/hooks/useSkillGroups.ts` — 新增 useSetGroupActive，移除 activate/deactivate hooks
- `src/hooks/useWorkspaces.ts` — 新增 useToggleGroupInWorkspace，移除 useApplyWorkspace
- `src/lib/api/skillGroups.ts` — 更新 API 方法
- `src/lib/api/workspaces.ts` — 更新 API 方法
- `src/components/skills/SkillGroupsPanel.tsx` — 激活改为 checkbox
- `src/components/skills/WorkspacesPanel.tsx` — 改为展开卡片交互
- `src/components/skills/UnifiedSkillsPanel.tsx` — 激活提示条改为显示激活数量

## 不在本次范围内
- 工作空间目录自动检测
- 分组顺序拖拽排序
