# Skill Groups & Workspace 重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将技能分组改为多选激活（取并集同步全局），移除快照机制，工作空间改为勾选即时同步的展开卡片交互。

**Architecture:** 数据库层新增 `workspace_group_active` 表并移除快照表；服务层新增两个并集同步函数替代原有快照激活逻辑；前端分组改为 Checkbox 多选，工作空间改为展开卡片内嵌分组勾选。

**Tech Stack:** Rust（rusqlite、Tauri）、TypeScript（React、@tanstack/react-query）、shadcn/ui

---

## 文件变更清单

### 修改
- `src-tauri/src/database/schema.rs` — DROP snapshot 表，ADD workspace_group_active，v15→v16
- `src-tauri/src/database/mod.rs` — SCHEMA_VERSION = 16
- `src-tauri/src/database/dao/skill_groups.rs` — 修改 set_skill_group_active（去掉先清零逻辑）
- `src-tauri/src/database/dao/workspaces.rs` — 新增 toggle/get workspace_group_active 方法
- `src-tauri/src/database/dao/skills.rs` — 移除三个快照方法
- `src-tauri/src/services/skill_group.rs` — 移除快照逻辑，新增 sync_active_groups_to_global
- `src-tauri/src/services/workspace_skill.rs` — 新增 sync_active_groups_to_workspace，修改触发逻辑
- `src-tauri/src/services/skill.rs` — 移除 disable_all_skills_with_db、enable_skills_by_ids_for_apps_with_db、sync_to_app_dir_pub
- `src-tauri/src/commands/skill_group.rs` — 移除 activate/deactivate_all，新增 set_group_active
- `src-tauri/src/commands/workspace_skill.rs` — 移除 apply_workspace，新增 toggle_group_in_workspace 和 get_workspace_active_group_ids
- `src-tauri/src/commands/skill.rs` — 移除 toggle_skill_app 里的 clear_all_skill_group_active 和 clear_skill_group_snapshot 调用
- `src-tauri/src/lib.rs` — 更新 invoke_handler
- `src/lib/api/skillGroups.ts` — 替换 activate/deactivateAll 为 setGroupActive
- `src/lib/api/workspaces.ts` — 移除 apply，新增 toggleGroupActive 和 getActiveGroupIds
- `src/hooks/useSkillGroups.ts` — 移除 useActivateSkillGroup/useDeactivateAllSkillGroups，新增 useSetGroupActive
- `src/hooks/useWorkspaces.ts` — 移除 useApplyWorkspace，新增 useToggleGroupInWorkspace 和 useWorkspaceActiveGroupIds
- `src/components/skills/SkillGroupsPanel.tsx` — 激活/停用按钮改为 Checkbox
- `src/components/skills/WorkspacesPanel.tsx` — 改为展开卡片交互
- `src/components/skills/UnifiedSkillsPanel.tsx` — 激活提示条改为显示激活分组数量
- `src/components/skills/WorkspaceEditDialog.tsx` — 移除分组绑定部分（移入 WorkspacesPanel 展开区）

---

## Task 1: 数据库 schema v15→v16

**Files:**
- Modify: `src-tauri/src/database/schema.rs`
- Modify: `src-tauri/src/database/mod.rs`

- [ ] **Step 1: SCHEMA_VERSION 改为 16**

`src-tauri/src/database/mod.rs` 第 47 行：
```rust
pub(crate) const SCHEMA_VERSION: i32 = 16;
```

- [ ] **Step 2: 在 `create_tables_on_conn` 末尾（`Ok(())` 前）追加 `workspace_group_active` 表**

在 `workspace_groups` 表定义之后追加：
```rust
        // 工作空间激活的分组（勾选即生效）
        conn.execute(
            "CREATE TABLE IF NOT EXISTS workspace_group_active (
                workspace_id TEXT NOT NULL,
                group_id TEXT NOT NULL,
                PRIMARY KEY (workspace_id, group_id),
                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
                FOREIGN KEY (group_id) REFERENCES skill_groups(id) ON DELETE CASCADE
            )",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
```

- [ ] **Step 3: 在 `apply_schema_migrations_on_conn` 中添加 `15 =>` 分支**

在 `14 =>` 分支之后、`_ =>` 之前添加：
```rust
                    15 => {
                        log::info!("迁移数据库从 v15 到 v16（移除快照表，添加 workspace_group_active）");
                        Self::migrate_v15_to_v16(conn)?;
                        Self::set_user_version(conn, 16)?;
                    }
```

- [ ] **Step 4: 实现 `migrate_v15_to_v16` 函数**

在 `migrate_v14_to_v15` 之后追加：
```rust
    fn migrate_v15_to_v16(conn: &Connection) -> Result<(), AppError> {
        conn.execute_batch(
            "DROP TABLE IF EXISTS skill_group_snapshot;
             CREATE TABLE IF NOT EXISTS workspace_group_active (
                workspace_id TEXT NOT NULL,
                group_id TEXT NOT NULL,
                PRIMARY KEY (workspace_id, group_id),
                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
                FOREIGN KEY (group_id) REFERENCES skill_groups(id) ON DELETE CASCADE
             );",
        )
        .map_err(|e| AppError::Database(e.to_string()))
    }
```

- [ ] **Step 5: 提交**

```bash
cd /Users/zhangyongtao03/code/personal/cc-switch
git add src-tauri/src/database/schema.rs src-tauri/src/database/mod.rs
git commit -m "feat(db): schema v16 — drop snapshot, add workspace_group_active"
```

---

## Task 2: DAO 层变更

**Files:**
- Modify: `src-tauri/src/database/dao/skill_groups.rs`
- Modify: `src-tauri/src/database/dao/workspaces.rs`
- Modify: `src-tauri/src/database/dao/skills.rs`

- [ ] **Step 1: 修改 `set_skill_group_active` — 去掉先清零所有分组的逻辑**

`src-tauri/src/database/dao/skill_groups.rs`，将：
```rust
    pub fn set_skill_group_active(&self, id: &str, active: bool) -> Result<(), AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn.transaction().map_err(|e| AppError::Database(e.to_string()))?;
        tx.execute("UPDATE skill_groups SET is_active = 0", [])
            .map_err(|e| AppError::Database(e.to_string()))?;
        if active {
            tx.execute(
                "UPDATE skill_groups SET is_active = 1 WHERE id = ?1",
                [id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        }
        tx.commit().map_err(|e| AppError::Database(e.to_string()))
    }
```
改为：
```rust
    pub fn set_skill_group_active(&self, id: &str, active: bool) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "UPDATE skill_groups SET is_active = ?1 WHERE id = ?2",
            rusqlite::params![active, id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }
```

- [ ] **Step 2: 新增查询所有激活分组的方法**

在 `skill_groups.rs` 的 `impl Database` 末尾追加：
```rust
    pub fn get_active_skill_group_ids(&self) -> Result<Vec<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT id FROM skill_groups WHERE is_active = 1")
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| AppError::Database(e.to_string()))?;
        rows.map(|r| r.map_err(|e| AppError::Database(e.to_string())))
            .collect()
    }
```

- [ ] **Step 3: 在 `workspaces.rs` 末尾新增三个 workspace_group_active 方法**

```rust
    pub fn toggle_workspace_group_active(
        &self,
        workspace_id: &str,
        group_id: &str,
        active: bool,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        if active {
            conn.execute(
                "INSERT OR IGNORE INTO workspace_group_active (workspace_id, group_id) VALUES (?1, ?2)",
                rusqlite::params![workspace_id, group_id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        } else {
            conn.execute(
                "DELETE FROM workspace_group_active WHERE workspace_id=?1 AND group_id=?2",
                rusqlite::params![workspace_id, group_id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        }
        Ok(())
    }

    pub fn get_workspace_active_group_ids(&self, workspace_id: &str) -> Result<Vec<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT group_id FROM workspace_group_active WHERE workspace_id=?1")
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map([workspace_id], |row| row.get::<_, String>(0))
            .map_err(|e| AppError::Database(e.to_string()))?;
        rows.map(|r| r.map_err(|e| AppError::Database(e.to_string())))
            .collect()
    }

    /// 获取绑定了指定分组的所有工作空间 ID（用于成员变化时批量同步）
    pub fn get_workspaces_with_active_group(&self, group_id: &str) -> Result<Vec<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT workspace_id FROM workspace_group_active WHERE group_id=?1")
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map([group_id], |row| row.get::<_, String>(0))
            .map_err(|e| AppError::Database(e.to_string()))?;
        rows.map(|r| r.map_err(|e| AppError::Database(e.to_string())))
            .collect()
    }
```

- [ ] **Step 4: 移除 `skills.rs` 中的三个快照方法**

找到并删除以下三个方法（及其注释）：
- `save_skill_group_snapshot`
- `restore_skill_group_snapshot`
- `clear_skill_group_snapshot`

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/database/dao/skill_groups.rs src-tauri/src/database/dao/workspaces.rs src-tauri/src/database/dao/skills.rs
git commit -m "feat(dao): multi-active groups and workspace_group_active DAO"
```

---

## Task 3: 服务层重构

**Files:**
- Modify: `src-tauri/src/services/skill_group.rs`
- Modify: `src-tauri/src/services/workspace_skill.rs`
- Modify: `src-tauri/src/services/skill.rs`

- [ ] **Step 1: 重写 `skill_group.rs`**

完整替换文件内容：
```rust
//! SkillGroup 业务逻辑层

use crate::app_config::SkillApps;
use crate::database::dao::skill_groups::{SkillGroup, SkillGroupApps};
use crate::database::Database;
use crate::services::skill::SkillService;
use anyhow::{anyhow, Result};
use chrono::Utc;
use std::collections::HashSet;
use std::sync::Arc;
use uuid::Uuid;

pub struct SkillGroupService;

impl SkillGroupService {
    pub fn create(
        db: &Arc<Database>,
        name: String,
        description: Option<String>,
        apps: SkillGroupApps,
    ) -> Result<SkillGroup> {
        let now = Utc::now().timestamp();
        let group = SkillGroup {
            id: Uuid::new_v4().to_string(),
            name,
            description,
            icon: None,
            is_active: false,
            sort_index: None,
            created_at: now,
            updated_at: now,
            apps,
            member_ids: vec![],
        };
        db.create_skill_group(&group)?;
        Ok(group)
    }

    pub fn update(
        db: &Arc<Database>,
        id: &str,
        name: String,
        description: Option<String>,
        apps: SkillGroupApps,
    ) -> Result<SkillGroup> {
        let mut group = db
            .get_skill_group(id)?
            .ok_or_else(|| anyhow!("分组不存在: {id}"))?;
        group.name = name;
        group.description = description;
        group.apps = apps;
        group.updated_at = Utc::now().timestamp();
        db.update_skill_group(&group)?;
        Ok(group)
    }

    /// 设置单个分组的全局激活状态，并重新同步全局 skills 目录
    pub fn set_active(db: &Arc<Database>, group_id: &str, active: bool) -> Result<()> {
        db.get_skill_group(group_id)?
            .ok_or_else(|| anyhow!("分组不存在: {group_id}"))?;
        db.set_skill_group_active(group_id, active)?;
        Self::sync_active_groups_to_global(db)
    }

    /// 计算所有激活分组的成员 skill 并集，全量同步到全局 app 目录
    pub fn sync_active_groups_to_global(db: &Arc<Database>) -> Result<()> {
        let active_group_ids = db.get_active_skill_group_ids()?;

        let mut skill_ids: HashSet<String> = HashSet::new();
        for gid in &active_group_ids {
            let members = db.get_group_member_ids(gid)?;
            skill_ids.extend(members);
        }

        // 先禁用所有 skill（只操作文件系统，不改数据库 enabled_*）
        SkillService::disable_all_skills(db)?;

        // 按 skill 自身的 per-app 开关重新启用并集中的 skill
        let mut failed: Vec<String> = Vec::new();
        for skill_id in &skill_ids {
            if let Ok(Some(skill)) = db.get_installed_skill(skill_id) {
                for app in skill.apps.enabled_apps() {
                    if let Err(e) = SkillService::sync_to_app_dir(&skill.directory, &app) {
                        log::warn!("sync_global: skill {} to {:?} 失败: {e}", skill.name, app);
                        failed.push(skill.name.clone());
                    }
                }
            }
        }

        if !failed.is_empty() {
            log::warn!("sync_global: {} 个 skill 同步失败", failed.len());
        }
        Ok(())
    }
}
```

- [ ] **Step 2: 重写 `workspace_skill.rs`**

完整替换文件内容：
```rust
//! WorkspaceSkill 业务逻辑层

use crate::database::Database;
use crate::services::skill::SkillService;
use anyhow::{anyhow, Result};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

pub struct ApplyResult {
    pub synced: usize,
    pub failed: Vec<String>,
}

pub struct WorkspaceSkillService;

impl WorkspaceSkillService {
    /// 切换工作空间中某分组的激活状态，并立即同步目录
    pub fn toggle_group(
        db: &Arc<Database>,
        workspace_id: &str,
        group_id: &str,
        active: bool,
    ) -> Result<()> {
        db.get_workspace(workspace_id)?
            .ok_or_else(|| anyhow!("工作空间不存在: {workspace_id}"))?;
        db.toggle_workspace_group_active(workspace_id, group_id, active)?;
        Self::sync_active_groups_to_workspace(db, workspace_id)
    }

    /// 计算工作空间已激活分组的成员 skill 并集，全量同步到 <path>/.claude/skills/
    pub fn sync_active_groups_to_workspace(db: &Arc<Database>, workspace_id: &str) -> Result<()> {
        let ws = db
            .get_workspace(workspace_id)?
            .ok_or_else(|| anyhow!("工作空间不存在: {workspace_id}"))?;

        let active_group_ids = db.get_workspace_active_group_ids(workspace_id)?;

        let mut skill_ids: HashSet<String> = HashSet::new();
        for gid in &active_group_ids {
            let members = db.get_group_member_ids(gid)?;
            skill_ids.extend(members);
        }

        let target_skills_dir = Path::new(&ws.path).join(".claude").join("skills");
        std::fs::create_dir_all(&target_skills_dir)
            .map_err(|e| anyhow!("创建目录失败 {}: {e}", target_skills_dir.display()))?;

        // 清空目录中现有 symlink（全量替换）
        Self::clear_skills_dir(&target_skills_dir)?;

        let ssot_dir = SkillService::get_ssot_dir()?;

        let mut synced = 0usize;
        let mut failed: Vec<String> = Vec::new();

        for skill_id in &skill_ids {
            match db.get_installed_skill(skill_id) {
                Ok(Some(skill)) => {
                    let source = ssot_dir.join(&skill.directory);
                    if !source.exists() {
                        log::warn!("sync_workspace: SSOT skill {} 不存在", skill.name);
                        failed.push(skill.name.clone());
                        continue;
                    }
                    let dest = target_skills_dir.join(&skill.directory);
                    match Self::create_symlink(&source, &dest) {
                        Ok(()) => synced += 1,
                        Err(e) => {
                            log::warn!("sync_workspace: symlink {} 失败: {e}", skill.name);
                            let _ = std::fs::remove_dir_all(&dest);
                            match Self::copy_dir(&source, &dest) {
                                Ok(()) => synced += 1,
                                Err(e2) => {
                                    log::warn!("sync_workspace: copy {} 失败: {e2}", skill.name);
                                    failed.push(skill.name.clone());
                                }
                            }
                        }
                    }
                }
                Ok(None) => {
                    log::warn!("sync_workspace: skill {skill_id} 不存在");
                    failed.push(skill_id.clone());
                }
                Err(e) => {
                    log::warn!("sync_workspace: 读取 skill {skill_id} 失败: {e}");
                    failed.push(skill_id.clone());
                }
            }
        }

        if !failed.is_empty() {
            log::warn!("sync_workspace {workspace_id}: {} 个 skill 失败", failed.len());
        }
        Ok(())
    }

    /// 当分组成员变化时，同步所有受影响的工作空间
    pub fn sync_workspaces_for_group(db: &Arc<Database>, group_id: &str) -> Result<()> {
        let workspace_ids = db.get_workspaces_with_active_group(group_id)?;
        for workspace_id in &workspace_ids {
            if let Err(e) = Self::sync_active_groups_to_workspace(db, workspace_id) {
                log::warn!("sync_workspaces_for_group: 工作空间 {workspace_id} 同步失败: {e}");
            }
        }
        Ok(())
    }

    fn clear_skills_dir(dir: &Path) -> Result<()> {
        if !dir.exists() {
            return Ok(());
        }
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_symlink() || path.is_dir() {
                let _ = std::fs::remove_dir_all(&path);
            } else {
                let _ = std::fs::remove_file(&path);
            }
        }
        Ok(())
    }

    fn create_symlink(source: &Path, dest: &Path) -> Result<()> {
        #[cfg(unix)]
        { std::os::unix::fs::symlink(source, dest)?; }
        #[cfg(windows)]
        { std::os::windows::fs::symlink_dir(source, dest)?; }
        Ok(())
    }

    fn copy_dir(source: &Path, dest: &Path) -> Result<()> {
        std::fs::create_dir_all(dest)?;
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            let dest_path = dest.join(entry.file_name());
            if entry.file_type()?.is_dir() {
                Self::copy_dir(&entry.path(), &dest_path)?;
            } else {
                std::fs::copy(entry.path(), &dest_path)?;
            }
        }
        Ok(())
    }
}
```

- [ ] **Step 3: 移除 `skill.rs` 中的三个方法**

找到并删除：
- `pub fn disable_all_skills_with_db` 函数（含整个函数体）
- `pub fn enable_skills_by_ids_for_apps_with_db` 函数
- `pub fn sync_to_app_dir_pub` 函数

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/services/skill_group.rs src-tauri/src/services/workspace_skill.rs src-tauri/src/services/skill.rs
git commit -m "feat(service): replace snapshot with multi-active sync logic"
```

---

## Task 4: 命令层 + 触发规则

**Files:**
- Modify: `src-tauri/src/commands/skill_group.rs`
- Modify: `src-tauri/src/commands/workspace_skill.rs`
- Modify: `src-tauri/src/commands/skill.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 修改 `commands/skill_group.rs`**

移除 `activate_skill_group` 和 `deactivate_all_skill_groups` 函数，新增：
```rust
#[tauri::command]
pub fn set_group_active(
    id: String,
    active: bool,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    SkillGroupService::set_active(&app_state.db, &id, active).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: 修改 `commands/workspace_skill.rs`**

移除 `apply_workspace` 函数，新增两个函数：
```rust
#[tauri::command]
pub fn toggle_group_in_workspace(
    workspace_id: String,
    group_id: String,
    active: bool,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    WorkspaceSkillService::toggle_group(&app_state.db, &workspace_id, &group_id, active)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_workspace_active_group_ids(
    workspace_id: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    app_state
        .db
        .get_workspace_active_group_ids(&workspace_id)
        .map_err(|e| e.to_string())
}
```

同时在文件顶部 import 中确保 `WorkspaceSkillService` 已导入。

- [ ] **Step 3: 修改 `commands/skill.rs` 中的 `toggle_skill_app`**

找到：
```rust
    // 手动修改即退出分组模式，清除激活状态和快照
    app_state.db.clear_all_skill_group_active().map_err(|e| e.to_string())?;
    app_state.db.clear_skill_group_snapshot().map_err(|e| e.to_string())?;
```
删除这两行（toggle_skill_app 不再干预分组状态）。

- [ ] **Step 4: 修改 `commands/mod.rs`**

确认 `workspace_skill` 模块已注册（已有），不需要额外改动。

- [ ] **Step 5: 修改 `lib.rs` invoke_handler**

替换：
```rust
            commands::activate_skill_group,
            commands::deactivate_all_skill_groups,
```
为：
```rust
            commands::set_group_active,
```

替换：
```rust
            commands::apply_workspace,
```
为：
```rust
            commands::toggle_group_in_workspace,
            commands::get_workspace_active_group_ids,
```

- [ ] **Step 6: 在分组成员变化命令中触发同步**

在 `commands/skill_group.rs` 中，找到 `add_skill_to_group` 和 `remove_skill_from_group` 命令，在原有 DAO 操作之后各加：

```rust
    // 同步到全局（若该分组已激活）
    if let Ok(Some(group)) = app_state.db.get_skill_group(&group_id) {
        if group.is_active {
            let _ = SkillGroupService::sync_active_groups_to_global(&app_state.db);
        }
    }
    // 同步到绑定该分组的工作空间
    let _ = WorkspaceSkillService::sync_workspaces_for_group(&app_state.db, &group_id);
```

需要在文件顶部添加：
```rust
use crate::services::workspace_skill::WorkspaceSkillService;
```

- [ ] **Step 7: 提交**

```bash
git add src-tauri/src/commands/skill_group.rs src-tauri/src/commands/workspace_skill.rs src-tauri/src/commands/skill.rs src-tauri/src/lib.rs
git commit -m "feat(commands): replace snapshot commands with multi-active and workspace sync"
```

---

## Task 5: 前端 API + Hooks

**Files:**
- Modify: `src/lib/api/skillGroups.ts`
- Modify: `src/lib/api/workspaces.ts`
- Modify: `src/hooks/useSkillGroups.ts`
- Modify: `src/hooks/useWorkspaces.ts`

- [ ] **Step 1: 修改 `src/lib/api/skillGroups.ts`**

读取文件，找到 `activate` 和 `deactivateAll` 方法，替换为：
```typescript
  setActive: (id: string, active: boolean): Promise<void> =>
    invoke("set_group_active", { id, active }),
```

- [ ] **Step 2: 修改 `src/lib/api/workspaces.ts`**

读取文件，移除 `apply` 方法，新增：
```typescript
  toggleGroupActive: (workspaceId: string, groupId: string, active: boolean): Promise<void> =>
    invoke("toggle_group_in_workspace", { workspaceId, groupId, active }),

  getActiveGroupIds: (workspaceId: string): Promise<string[]> =>
    invoke("get_workspace_active_group_ids", { workspaceId }),
```

- [ ] **Step 3: 修改 `src/hooks/useSkillGroups.ts`**

读取文件，移除 `useActivateSkillGroup` 和 `useDeactivateAllSkillGroups`，新增：
```typescript
export function useSetGroupActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      skillGroupsApi.setActive(id, active),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skillGroups"] });
      qc.invalidateQueries({ queryKey: ["skills", "installed"] });
    },
  });
}
```

- [ ] **Step 4: 修改 `src/hooks/useWorkspaces.ts`**

读取文件，移除 `useApplyWorkspace`，新增：
```typescript
export function useToggleGroupInWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      groupId,
      active,
    }: {
      workspaceId: string;
      groupId: string;
      active: boolean;
    }) => workspacesApi.toggleGroupActive(workspaceId, groupId, active),
    onSuccess: (_data, { workspaceId }) => {
      qc.invalidateQueries({ queryKey: ["workspaces", "activeGroups", workspaceId] });
    },
  });
}

export function useWorkspaceActiveGroupIds(workspaceId: string | null) {
  return useQuery({
    queryKey: ["workspaces", "activeGroups", workspaceId],
    queryFn: () => workspacesApi.getActiveGroupIds(workspaceId!),
    enabled: !!workspaceId,
    staleTime: Infinity,
  });
}
```

- [ ] **Step 5: 提交**

```bash
git add src/lib/api/skillGroups.ts src/lib/api/workspaces.ts src/hooks/useSkillGroups.ts src/hooks/useWorkspaces.ts
git commit -m "feat(frontend): update API and hooks for multi-active groups and workspace toggle"
```

---

## Task 6: 前端 UI — SkillGroupsPanel 改为 Checkbox

**Files:**
- Modify: `src/components/skills/SkillGroupsPanel.tsx`

- [ ] **Step 1: 读取现有文件，了解结构**

```bash
cat src/components/skills/SkillGroupsPanel.tsx
```

- [ ] **Step 2: 重写 SkillGroupsPanel.tsx**

完整替换文件内容：
```tsx
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Plus, Edit2, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SkillGroupEditDialog } from "./SkillGroupEditDialog";
import { AppToggleGroup } from "@/components/common/AppToggleGroup";
import { SKILLS_APP_IDS } from "@/config/appConfig";
import {
  useSkillGroups,
  useCreateSkillGroup,
  useUpdateSkillGroup,
  useDeleteSkillGroup,
  useSetGroupActive,
} from "@/hooks/useSkillGroups";
import type { AppId } from "@/lib/api/types";
import type { SkillGroup, SkillGroupApps } from "@/lib/api/skills";

export function SkillGroupsPanel() {
  const { t } = useTranslation();
  const { data: groups = [], isLoading } = useSkillGroups();

  const [editDialogState, setEditDialogState] = useState<{
    open: boolean;
    group: SkillGroup | null;
  }>({ open: false, group: null });

  const [confirmDelete, setConfirmDelete] = useState<{
    open: boolean;
    group: SkillGroup | null;
  }>({ open: false, group: null });

  const createMutation = useCreateSkillGroup();
  const updateMutation = useUpdateSkillGroup();
  const deleteMutation = useDeleteSkillGroup();
  const setActiveMutation = useSetGroupActive();

  const handleSave = async (params: { name: string; description?: string; apps: SkillGroupApps }) => {
    const { group } = editDialogState;
    try {
      if (group) {
        await updateMutation.mutateAsync({ id: group.id, ...params });
        toast.success(t("skillGroups.updated", "分组已更新"));
      } else {
        await createMutation.mutateAsync(params);
        toast.success(t("skillGroups.created", "分组已创建"));
      }
      setEditDialogState({ open: false, group: null });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete.group) return;
    try {
      await deleteMutation.mutateAsync(confirmDelete.group.id);
      toast.success(t("skillGroups.deleted", "分组已删除"));
      setConfirmDelete({ open: false, group: null });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    }
  };

  const handleToggleActive = async (group: SkillGroup, checked: boolean) => {
    try {
      await setActiveMutation.mutateAsync({ id: group.id, active: checked });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("skillGroups.description", "将 Skill 按场景分组，一键切换当前激活集合")}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditDialogState({ open: true, group: null })}
        >
          <Plus className="h-4 w-4 mr-1" />
          {t("skillGroups.new", "新建分组")}
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {t("skillGroups.empty", "还没有分组，点击「新建分组」开始")}
        </div>
      ) : (
        <TooltipProvider delayDuration={300}>
        <div className="space-y-2">
          {groups.map((group) => (
            <div
              key={group.id}
              className={`flex items-center gap-4 rounded-lg px-4 py-3 border ${
                group.isActive
                  ? "border-primary bg-primary/5"
                  : "border-border-default"
              }`}
            >
              <Checkbox
                checked={group.isActive}
                onCheckedChange={(v) => handleToggleActive(group, !!v)}
                disabled={setActiveMutation.isPending}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`font-medium text-sm ${group.isActive ? "text-primary" : ""}`}>
                    {group.name}
                  </span>
                </div>
                {group.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {group.description}
                  </p>
                )}
              </div>
              <AppToggleGroup
                apps={group.apps}
                onToggle={() => {}}
                appIds={SKILLS_APP_IDS}
              />
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setEditDialogState({ open: true, group })}
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete({ open: true, group })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        </TooltipProvider>
      )}

      <SkillGroupEditDialog
        open={editDialogState.open}
        group={editDialogState.group}
        onClose={() => setEditDialogState({ open: false, group: null })}
        onSave={handleSave}
        saving={createMutation.isPending || updateMutation.isPending}
      />

      <ConfirmDialog
        isOpen={confirmDelete.open}
        title={t("skillGroups.deleteTitle", "删除分组")}
        message={t(
          "skillGroups.deleteMessage",
          "确认删除「{{name}}」？分组内的 Skill 不会被卸载。",
          { name: confirmDelete.group?.name }
        )}
        confirmText={t("common.delete", "删除")}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete({ open: false, group: null })}
      />
    </div>
  );
}
```

- [ ] **Step 3: 提交**

```bash
git add src/components/skills/SkillGroupsPanel.tsx
git commit -m "feat(ui): replace activate button with checkbox for multi-active groups"
```

---

## Task 7: 前端 UI — WorkspacesPanel 改为展开卡片

**Files:**
- Modify: `src/components/skills/WorkspacesPanel.tsx`
- Modify: `src/components/skills/WorkspaceEditDialog.tsx`

- [ ] **Step 1: 重写 `WorkspacesPanel.tsx`**

完整替换文件内容：
```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Edit2, Trash2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { WorkspaceEditDialog } from "./WorkspaceEditDialog";
import {
  useWorkspaces,
  useCreateWorkspace,
  useUpdateWorkspace,
  useDeleteWorkspace,
  useToggleGroupInWorkspace,
  useWorkspaceActiveGroupIds,
} from "@/hooks/useWorkspaces";
import { useSkillGroups } from "@/hooks/useSkillGroups";
import type { Workspace } from "@/lib/api/workspaces";

function WorkspaceGroupList({ workspace }: { workspace: Workspace }) {
  const { t } = useTranslation();
  const { data: groups = [] } = useSkillGroups();
  const { data: activeGroupIds = [] } = useWorkspaceActiveGroupIds(workspace.id);
  const toggleMutation = useToggleGroupInWorkspace();

  const handleToggle = async (groupId: string, checked: boolean) => {
    try {
      await toggleMutation.mutateAsync({ workspaceId: workspace.id, groupId, active: checked });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    }
  };

  if (groups.length === 0) {
    return (
      <div className="px-4 py-3 text-sm text-muted-foreground">
        {t("workspaces.noGroupsAvailable", "还没有分组，请先在「分组」标签页创建分组")}
      </div>
    );
  }

  return (
    <div className="px-4 pb-3 space-y-1">
      {groups.map((group) => {
        const checked = activeGroupIds.includes(group.id);
        return (
          <label
            key={group.id}
            className="flex items-center gap-2 cursor-pointer rounded px-1 py-1.5 hover:bg-accent"
          >
            <Checkbox
              checked={checked}
              onCheckedChange={(v) => handleToggle(group.id, !!v)}
              disabled={toggleMutation.isPending}
            />
            <span className={`text-sm ${checked ? "text-primary font-medium" : ""}`}>
              {group.name}
            </span>
            {group.description && (
              <span className="text-xs text-muted-foreground truncate flex-1">
                {group.description}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}

export function WorkspacesPanel() {
  const { t } = useTranslation();
  const { data: workspaces = [], isLoading } = useWorkspaces();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [editState, setEditState] = useState<{
    open: boolean;
    workspace: Workspace | null;
  }>({ open: false, workspace: null });

  const [confirmDelete, setConfirmDelete] = useState<{
    open: boolean;
    workspace: Workspace | null;
  }>({ open: false, workspace: null });

  const createMutation = useCreateWorkspace();
  const updateMutation = useUpdateWorkspace();
  const deleteMutation = useDeleteWorkspace();

  const handleSave = async (params: { name: string; path: string }) => {
    try {
      if (editState.workspace) {
        await updateMutation.mutateAsync({ id: editState.workspace.id, ...params });
        toast.success(t("workspaces.updated", "工作空间已更新"));
      } else {
        await createMutation.mutateAsync(params);
        toast.success(t("workspaces.created", "工作空间已创建"));
      }
      setEditState({ open: false, workspace: null });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete.workspace) return;
    try {
      await deleteMutation.mutateAsync(confirmDelete.workspace.id);
      toast.success(t("workspaces.deleted", "工作空间已删除"));
      if (expandedId === confirmDelete.workspace.id) setExpandedId(null);
      setConfirmDelete({ open: false, workspace: null });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("workspaces.description", "将项目目录与 Skill 分组绑定，一键同步到局部配置")}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditState({ open: true, workspace: null })}
        >
          <Plus className="h-4 w-4 mr-1" />
          {t("workspaces.new", "新建工作空间")}
        </Button>
      </div>

      {workspaces.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {t("workspaces.empty", "还没有工作空间，点击「新建工作空间」开始")}
        </div>
      ) : (
        <div className="space-y-2">
          {workspaces.map((ws) => {
            const expanded = expandedId === ws.id;
            return (
              <div key={ws.id} className="rounded-lg border border-border-default overflow-hidden">
                {/* 卡片头部 */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 select-none"
                  onClick={() => toggleExpand(ws.id)}
                >
                  {expanded
                    ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{ws.name}</div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">{ws.path}</div>
                  </div>
                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setEditState({ open: true, workspace: ws })}
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setConfirmDelete({ open: true, workspace: ws })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {/* 展开内容 */}
                {expanded && (
                  <div className="border-t border-border-default bg-muted/20">
                    <WorkspaceGroupList workspace={ws} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <WorkspaceEditDialog
        open={editState.open}
        workspace={editState.workspace}
        onClose={() => setEditState({ open: false, workspace: null })}
        onSave={handleSave}
        saving={createMutation.isPending || updateMutation.isPending}
      />

      <ConfirmDialog
        isOpen={confirmDelete.open}
        title={t("workspaces.deleteTitle", "删除工作空间")}
        message={t(
          "workspaces.deleteMessage",
          "确认删除「{{name}}」？不会删除目录下已同步的 Skill 文件。",
          { name: confirmDelete.workspace?.name }
        )}
        confirmText={t("common.delete", "删除")}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete({ open: false, workspace: null })}
      />
    </div>
  );
}
```

- [ ] **Step 2: 简化 `WorkspaceEditDialog.tsx` — 移除分组绑定部分**

读取文件，找到 `{workspace && (` 开头的分组绑定区域，完整删除这个条件渲染块（从 `{workspace && (` 到对应的 `)}`）。同时移除相关 import（`useAddGroupToWorkspace`、`useRemoveGroupFromWorkspace`、`useWorkspaces`、`Checkbox`、`Search`）中不再使用的部分。

- [ ] **Step 3: 提交**

```bash
git add src/components/skills/WorkspacesPanel.tsx src/components/skills/WorkspaceEditDialog.tsx
git commit -m "feat(ui): workspace expand-card interaction with inline group toggle"
```

---

## Task 8: 前端 UI — UnifiedSkillsPanel 激活提示条

**Files:**
- Modify: `src/components/skills/UnifiedSkillsPanel.tsx`

- [ ] **Step 1: 更新激活提示条显示激活数量**

读取文件，找到 `activeGroup` 相关代码，替换：

原来：
```typescript
const activeGroup = groups.find((g) => g.isActive);
```
改为：
```typescript
const activeGroups = groups.filter((g) => g.isActive);
```

找到激活提示条 JSX，将：
```tsx
{activeGroup && activeTab === "installed" && (
  <div ...>
    {activeGroup.icon && <span>{activeGroup.icon}</span>}
    <span ...>{t("skillGroups.activeLabelPrefix", "分组：")} </span>
    <span ...>{activeGroup.name}</span>
    <Button ... onClick={() => deactivateGroupMutation.mutate()} ...>
      {t("skillGroups.deactivate", "停用")}
    </Button>
  </div>
)}
```
改为：
```tsx
{activeGroups.length > 0 && activeTab === "installed" && (
  <div className="flex items-center gap-2 mb-2 pl-3 pr-2 py-1.5 border-l-2 border-primary text-sm">
    <span className="text-muted-foreground">{t("skillGroups.activeLabelPrefix", "分组：")} </span>
    <span className="font-medium text-foreground truncate flex-1">
      {t("skillGroups.activeCount", "{{count}} 个已激活", { count: activeGroups.length })}
    </span>
  </div>
)}
```

同时移除 `deactivateGroupMutation` 的声明（`useDeactivateAllSkillGroups` 不再使用）：
找到 `const deactivateGroupMutation = useDeactivateAllSkillGroups();` 删除这一行。

移除 import 中的 `useDeactivateAllSkillGroups`。

- [ ] **Step 2: 提交**

```bash
git add src/components/skills/UnifiedSkillsPanel.tsx
git commit -m "feat(ui): update active banner to show count of active groups"
```

---

## 自审结果

**Spec 覆盖检查：**
- ✅ schema v15→v16：DROP snapshot，ADD workspace_group_active → Task 1
- ✅ set_skill_group_active 改为单独设置不清零其他 → Task 2
- ✅ 新增 toggle/get workspace_group_active DAO → Task 2
- ✅ 移除快照相关 DAO 方法 → Task 2
- ✅ sync_active_groups_to_global（多激活并集） → Task 3
- ✅ sync_active_groups_to_workspace（工作空间同步） → Task 3
- ✅ 移除三个 _with_db 辅助方法 → Task 3
- ✅ set_group_active 命令 → Task 4
- ✅ toggle_group_in_workspace 命令 → Task 4
- ✅ toggle_skill_app 不再干预分组状态 → Task 4
- ✅ 分组成员变化触发同步 → Task 4
- ✅ 前端 API + hooks 更新 → Task 5
- ✅ SkillGroupsPanel 改为 Checkbox 多选 → Task 6
- ✅ WorkspacesPanel 改为展开卡片 → Task 7
- ✅ 激活提示条改为显示数量 → Task 8

**类型一致性：**
- `useSetGroupActive` 接受 `{ id, active }` ↔ `set_group_active(id, active)` ✅
- `useToggleGroupInWorkspace` 接受 `{ workspaceId, groupId, active }` ↔ `toggle_group_in_workspace(workspace_id, group_id, active)` ✅
- `WorkspaceGroupList` 使用 `useWorkspaceActiveGroupIds(workspace.id)` ✅
