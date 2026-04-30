# Skill Groups 设计文档

**日期**：2026-04-30  
**状态**：待实现

## 需求概述

用户希望将已安装的 Skill 按工作场景分组（如"写作模式"、"编程模式"），手动切换激活的分组，实现一键改变当前生效的 Skill 集合。

## 核心决策

| 问题 | 决策 |
|------|------|
| 环境类型 | 工作场景/项目（非 AI 应用类型，非机器） |
| 切换方式 | 手动切换（UI 点击） |
| 激活语义 | 独占模式：同一时间只有一个组激活 |
| Skill 归属 | 一个 Skill 可属于多个分组 |
| App 维度 | 激活分组时沿用 Skill 自身现有的 per-app 开关 |

## 数据层

### 新增两张表

```sql
-- 技能组定义
CREATE TABLE skill_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    is_active BOOLEAN NOT NULL DEFAULT 0,
    sort_index INTEGER,
    created_at INTEGER,
    updated_at INTEGER
);

-- 技能与分组多对多关联
CREATE TABLE skill_group_members (
    group_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    PRIMARY KEY (group_id, skill_id),
    FOREIGN KEY (group_id) REFERENCES skill_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);
```

### 激活流程

`activate_skill_group(id)` 的执行步骤：

1. 将所有 skill 的 `enabled_*` 全部置 false，从各 app 目录移除 symlink/copy
2. 将目标组所有成员 skill 按其**自身现有的 per-app 开关**重新同步文件系统
3. 将所有组 `is_active = 0`，目标组 `is_active = 1`

`deactivate_all_groups()` 执行步骤：

1. 将所有 skill 的文件系统同步全部移除
2. 所有组 `is_active = 0`

> 注意：激活/停用操作复用现有 `SkillService::sync_skill_to_apps` 逻辑，不重新实现文件系统操作。

## 后端命令层

新增文件：`src-tauri/src/commands/skill_group.rs`

```
get_skill_groups()                              → Vec<SkillGroup>
create_skill_group(name, description, icon)     → SkillGroup
update_skill_group(id, name, description, icon) → SkillGroup
delete_skill_group(id)                          → ()
activate_skill_group(id)                        → ()
deactivate_all_groups()                         → ()
add_skill_to_group(group_id, skill_id)          → ()
remove_skill_from_group(group_id, skill_id)     → ()
get_group_members(group_id)                     → Vec<String>
```

同步在新增文件：
- `src-tauri/src/database/dao/skill_groups.rs` — DAO 层
- `src-tauri/src/services/skill_group.rs` — 业务逻辑层

## 前端 UI

### 入口

Skills 页面新增标签页：

```
[已安装] [分组]
```

### 分组列表页（`SkillGroupsPanel.tsx`）

- 每个分组显示为卡片：图标、名称、描述、包含 skill 数量
- 激活的组有高亮边框标记
- 每张卡片操作：**激活** / **停用** / **编辑** / **删除**
- 右上角"新建分组"按钮

### 分组编辑弹窗（`SkillGroupEditDialog.tsx`）

- 编辑字段：名称、描述、图标（emoji）
- Skill 选择列表：从已安装 skill 勾选，支持搜索过滤
- 每行 skill 显示其 per-app 开关状态（只读 badge，不在此修改）

### 已安装列表变化

- `SkillCard` 新增：显示该 skill 所属分组名（小 badge）
- 当有组激活时，页面顶部显示提示条：
  ```
  当前激活：写作模式  [停用]
  ```

## 文件变更清单

### 新增文件
- `src-tauri/src/commands/skill_group.rs`
- `src-tauri/src/database/dao/skill_groups.rs`
- `src-tauri/src/services/skill_group.rs`
- `src/components/skills/SkillGroupsPanel.tsx`
- `src/components/skills/SkillGroupEditDialog.tsx`
- `src/hooks/useSkillGroups.ts`
- `src/lib/api/skillGroups.ts`

### 修改文件
- `src-tauri/src/database/schema.rs` — 新增两张表 + migration
- `src-tauri/src/commands/mod.rs` — 注册新命令
- `src-tauri/src/lib.rs` — 注册新命令到 Tauri
- `src/components/skills/UnifiedSkillsPanel.tsx` — 新增标签页 + 激活提示条
- `src/components/skills/SkillCard.tsx` — 新增分组 badge

## 不在本次范围内

- 自动切换（检测项目类型触发）
- 分组导入/导出
- WebDAV 同步分组数据
