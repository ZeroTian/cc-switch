# Skills 管理重构设计

## Goal

重构 Skills 管理的三个 Tab，职责分离，以工作空间为同步决策中心，消除分组激活、快照等历史包袱。

## Architecture

工作空间成为唯一的同步决策层。技能只管自身属性（适用 agent），分组只管成员集合，工作空间决定"哪些技能同步到哪个目录"。同步时取工作空间绑定的分组成员 ∪ 直绑技能，再按各 skill 自身的 apps 配置决定写入哪些 agent 子目录。

## Tech Stack

- Rust / Tauri 后端，rusqlite 数据库
- React + TanStack Query 前端
- 现有 `SkillService`、`WorkspaceSkillService` 服务层复用，`SkillGroupService` 简化

---

## 数据库变更

### 删除的列／表

- `skill_groups.is_active` 列
- `skill_groups.enabled_claude/codex/gemini/opencode/hermes` 列（5 列）
- `skill_group_snapshot` 表（整张表废弃）
- `workspace_groups` 表（替换为新表）
- `workspace_group_active` 表（替换为新表）

### 新增

```sql
-- 工作空间直接绑定单个 skill
CREATE TABLE workspace_skill_bindings (
  workspace_id TEXT NOT NULL,
  skill_id     TEXT NOT NULL,
  PRIMARY KEY (workspace_id, skill_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id)     REFERENCES installed_skills(id) ON DELETE CASCADE
);

-- 工作空间绑定分组（替代旧 workspace_groups + workspace_group_active）
CREATE TABLE workspace_group_bindings (
  workspace_id TEXT NOT NULL,
  group_id     TEXT NOT NULL,
  PRIMARY KEY (workspace_id, group_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id)     REFERENCES skill_groups(id) ON DELETE CASCADE
);
```

### 修改

- `workspaces` 表新增列 `is_user_level INTEGER NOT NULL DEFAULT 0`
- 迁移时插入固定行：`id='user', name='用户级别', path='~', is_user_level=1`
- 旧 `workspace_groups`（勾选状态）迁移到 `workspace_group_bindings`

### skill_groups 表

删除 `is_active` 和 5 个 `enabled_*` 列后，保留：`id, name, description, icon, sort_index, created_at, updated_at`。

---

## 后端服务变更

### SkillGroupService

- 删除 `set_active`、`sync_active_groups_to_global`
- `update` 方法签名变为 `(db, id, name, description, member_ids) -> SkillGroup`（无 apps 参数）
- `create` 方法签名变为 `(db, name, description) -> SkillGroup`（无 apps 参数）

### WorkspaceSkillService（新增方法）

```rust
// 获取工作空间的直绑 skill_id 列表
fn get_workspace_skill_bindings(db, workspace_id) -> Vec<String>

// 设置工作空间直绑 skill（全量替换）
fn set_workspace_skill_bindings(db, workspace_id, skill_ids: &[String])

// 获取工作空间的绑定分组 id 列表
fn get_workspace_group_bindings(db, workspace_id) -> Vec<String>

// toggle 工作空间绑定分组
fn toggle_workspace_group(db, workspace_id, group_id, active: bool)

// toggle 工作空间直绑 skill
fn toggle_workspace_skill(db, workspace_id, skill_id, active: bool)

// 核心同步：计算工作空间的 skill 并集并同步到文件系统
// 并集 = 直绑 skill ∪ 所有绑定分组的成员
// 每个 skill 同步的 app 目录 = skill.apps.enabled_apps()
fn sync_workspace(db, workspace_id) -> Result<()>
```

删除 `sync_active_groups_to_global`，所有同步入口改为 `sync_workspace(workspace_id)`。

当分组成员变化（`update_skill_group`）时，找到所有绑定该分组的工作空间，逐一调用 `sync_workspace`。

### 初始化

应用启动时，若 `workspaces` 表中不存在 `is_user_level=1` 的行，插入：

```sql
INSERT INTO workspaces (id, name, path, is_user_level)
VALUES ('user', '用户级别', '~', 1)
```

---

## 前端变更

### 已安装 Tab

- **保留**：app toggle（per-skill），分组 badge
- **移除**：无额外变更

### 分组 Tab（SkillGroupsPanel）

- 卡片行：名称、描述、成员数量（`group.memberIds.length` 个 skill）
- 移除：apps toggle、激活 checkbox
- 编辑对话框（SkillGroupEditDialog）：移除 apps 配置区，只保留名称/描述/成员勾选
- 成员勾选维持草稿模式，点保存才提交

### 工作空间 Tab（WorkspacesPanel）

布局：

```
┌─────────────────────────────────────────┐
│ 用户级别  ~/                    [编辑] │  ← 固定置顶，无删除按钮，特殊背景色
│   ▼ 展开                               │
│   ┌ 分组 ──────────────────────────┐   │
│   │ ☑ cli自动化流程  (3 个 skill)  │   │
│   │ ☐ 问题排查      (2 个 skill)   │   │
│   └────────────────────────────────┘   │
│   ┌ 单独 Skill ────────────────────┐   │
│   │ ☐ my-custom-skill              │   │
│   └────────────────────────────────┘   │
│   共 N 个 skill 将被同步              │
├─────────────────────────────────────────┤
│ + 新建工作空间                         │
├─────────────────────────────────────────┤
│ ▶ my-project  /Users/.../my-project    │
│ ▶ another     /Users/.../another       │
└─────────────────────────────────────────┘
```

交互规则：
- 勾选/取消勾选分组或 skill：即时调用后端 toggle，立即触发该工作空间同步
- 展开时实时显示「共 N 个 skill 将被同步」（去重后的并集数量）
- 用户级别空间无删除按钮，路径显示 `~`（不可编辑路径，但可编辑名称）
- 新建工作空间路径不能填 `~`（前端校验）

### 导入已有

扫描并导入 unmanaged skill 后：
- 导入的 skill 自动绑定到用户级别工作空间（`workspace_id='user'`）
- 触发用户级别空间同步

---

## 命令层变更

### 删除的命令

- `set_group_active`
- `add_skill_to_group` / `remove_skill_from_group`（合并到 `update_skill_group`）

### 新增命令

```rust
toggle_workspace_group(workspace_id, group_id, active: bool) -> ()
toggle_workspace_skill(workspace_id, skill_id, active: bool) -> ()
get_workspace_bindings(workspace_id) -> WorkspaceBindings
  // WorkspaceBindings { group_ids: Vec<String>, skill_ids: Vec<String>, total_skill_count: usize }
```

### 修改的命令

- `create_skill_group(name, description)` — 去掉 apps 参数
- `update_skill_group(id, name, description, member_ids)` — 去掉 apps 参数

---

## SkillGroupApps 类型清理

- 后端删除 `SkillGroupApps` 结构体及相关 DB 列
- 前端删除 `SkillGroup.apps` 字段、`SkillGroupApps` 类型
- `AppToggleGroup` 在分组相关组件中的引用全部移除

---

## 数据迁移策略

migration 版本升级：

1. 创建 `workspace_skill_bindings`、`workspace_group_bindings` 表
2. 将旧 `workspace_group_active`（active=1 的行）迁移到 `workspace_group_bindings`
3. `workspaces` 表 ALTER 加 `is_user_level` 列
4. 插入用户级别空间行（若不存在）
5. 删除旧表：`workspace_groups`、`workspace_group_active`、`skill_group_snapshot`
6. `skill_groups` 表 ALTER 删除 `is_active` 和 5 个 `enabled_*` 列（SQLite 需重建表）

---

## 不在本次范围内

- 工作空间同步冲突检测
- 工作空间导出/导入
- 分组排序拖拽
