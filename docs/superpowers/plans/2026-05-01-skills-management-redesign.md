# Skills 管理重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 Skills 管理三个 Tab，以工作空间为唯一同步决策层，技能只管属性，分组只管成员，工作空间决定同步。

**Architecture:** 数据库迁移到 v17，新增 workspace_skill_bindings / workspace_group_bindings 表，workspaces 表加 is_user_level 列，删除 skill_groups 的 is_active 和 enabled_* 列。后端 WorkspaceSkillService 统一同步逻辑，前端三个 Tab 职责分离。

**Tech Stack:** Rust/Tauri, rusqlite, React, TanStack Query

---

## 文件结构

### 后端（修改）
- `src-tauri/src/database/mod.rs` — 升 SCHEMA_VERSION 到 17，新增 migration_v17
- `src-tauri/src/database/dao/skill_groups.rs` — 删除 SkillGroupApps / is_active / enabled_* 相关字段和方法
- `src-tauri/src/database/dao/workspaces.rs` — 新增（或修改现有）workspace_skill_bindings / workspace_group_bindings 的 DAO 方法
- `src-tauri/src/services/skill_group.rs` — 简化 create/update 签名，删除 set_active / sync_active_groups_to_global
- `src-tauri/src/services/workspace_skill.rs` — 重写同步逻辑，新增 toggle_workspace_skill / toggle_workspace_group / sync_workspace / get_workspace_bindings
- `src-tauri/src/commands/skill_group.rs` — 删除 set_group_active / add_skill_to_group / remove_skill_from_group，更新 create/update 签名
- `src-tauri/src/commands/workspace_skill.rs` — 新增 toggle_workspace_skill / toggle_workspace_group / get_workspace_bindings
- `src-tauri/src/lib.rs` — 更新 generate_handler! 注册列表

### 前端（修改）
- `src/lib/api/skills.ts` — 删除 SkillGroupApps 类型，更新 SkillGroup 接口
- `src/lib/api/skillGroups.ts` — 更新 create/update 签名
- `src/lib/api/workspaces.ts` — 新增 toggleSkill / toggleGroup / getBindings API
- `src/hooks/useSkillGroups.ts` — 更新 mutation 签名
- `src/hooks/useWorkspaces.ts` — 新增 useToggleWorkspaceSkill / useToggleWorkspaceGroup / useWorkspaceBindings
- `src/components/skills/SkillGroupsPanel.tsx` — 移除 apps toggle 和激活 checkbox
- `src/components/skills/SkillGroupEditDialog.tsx` — 移除 apps 配置区
- `src/components/skills/WorkspacesPanel.tsx` — 重写：用户级别空间置顶，展开内含分组区+单独skill区

---

## Task 1: 数据库迁移 v17

**Files:**
- Modify: `src-tauri/src/database/mod.rs`

- [ ] **Step 1: 升级 SCHEMA_VERSION 并添加 migration_v17 函数**

在 `src-tauri/src/database/mod.rs` 中，将 `SCHEMA_VERSION: i32 = 16` 改为 `17`，并在 migrate 函数中添加 v17 分支：

```rust
// 将
const SCHEMA_VERSION: i32 = 16;
// 改为
const SCHEMA_VERSION: i32 = 17;
```

在 migrate 函数的 match 分支中添加（找到类似 `16 => migrate_v16(conn)?` 的位置，在其后添加）：

```rust
17 => migrate_v17(conn)?,
```

- [ ] **Step 2: 实现 migrate_v17 函数**

在文件末尾（或 migrate_v16 之后）添加：

```rust
fn migrate_v17(conn: &Connection) -> rusqlite::Result<()> {
    // 1. workspaces 表加 is_user_level 列
    conn.execute_batch(
        "ALTER TABLE workspaces ADD COLUMN is_user_level INTEGER NOT NULL DEFAULT 0;",
    ).ok(); // 若列已存在则忽略

    // 2. 插入用户级别空间（若不存在）
    conn.execute(
        "INSERT OR IGNORE INTO workspaces (id, name, path, is_user_level, created_at, updated_at)
         VALUES ('user', '用户级别', '~', 1, unixepoch(), unixepoch())",
        [],
    )?;

    // 3. 新建 workspace_skill_bindings 表
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS workspace_skill_bindings (
            workspace_id TEXT NOT NULL,
            skill_id     TEXT NOT NULL,
            PRIMARY KEY (workspace_id, skill_id)
        );",
    )?;

    // 4. 新建 workspace_group_bindings 表，迁移旧数据
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS workspace_group_bindings (
            workspace_id TEXT NOT NULL,
            group_id     TEXT NOT NULL,
            PRIMARY KEY (workspace_id, group_id)
        );",
    )?;

    // 5. 迁移旧 workspace_group_active（active=1）到新表
    conn.execute_batch(
        "INSERT OR IGNORE INTO workspace_group_bindings (workspace_id, group_id)
         SELECT workspace_id, group_id FROM workspace_group_active WHERE active = 1;",
    ).ok(); // 旧表可能不存在

    // 6. 重建 skill_groups 表（SQLite 不支持 DROP COLUMN，需重建）
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS skill_groups_new (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT,
            icon        TEXT,
            sort_index  INTEGER,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO skill_groups_new (id, name, description, icon, sort_index, created_at, updated_at)
            SELECT id, name, description, icon, sort_index, created_at, updated_at FROM skill_groups;
        DROP TABLE skill_groups;
        ALTER TABLE skill_groups_new RENAME TO skill_groups;
    ")?;

    // 7. 删除废弃旧表（忽略不存在错误）
    conn.execute_batch("DROP TABLE IF EXISTS workspace_groups;").ok();
    conn.execute_batch("DROP TABLE IF EXISTS workspace_group_active;").ok();
    conn.execute_batch("DROP TABLE IF EXISTS skill_group_snapshot;").ok();

    Ok(())
}
```

- [ ] **Step 3: 编译验证迁移代码**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep "^error"
```

Expected: 无输出（无编译错误）

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/database/mod.rs
git commit -m "feat(db): migrate v17 - workspace bindings tables, remove skill_group apps/active"
```

---

## Task 2: 更新 skill_groups DAO

**Files:**
- Modify: `src-tauri/src/database/dao/skill_groups.rs`

- [ ] **Step 1: 删除 SkillGroupApps 结构体及相关 impl**

将文件头部的 `SkillGroupApps` 结构体和 `impl SkillGroupApps` 块全部删除：

```rust
// 删除这整段：
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillGroupApps {
    pub claude: bool,
    pub codex: bool,
    pub gemini: bool,
    pub opencode: bool,
    pub hermes: bool,
}

// 删除这整段：
impl SkillGroupApps {
    pub fn enabled_apps(&self) -> Vec<crate::app_config::AppType> {
        // ...
    }
}
```

- [ ] **Step 2: 更新 SkillGroup 结构体**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillGroup {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub sort_index: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub member_ids: Vec<String>,
}
```

- [ ] **Step 3: 更新 row_to_group 和所有 SQL 查询**

```rust
fn row_to_group(row: &rusqlite::Row<'_>) -> rusqlite::Result<SkillGroup> {
    Ok(SkillGroup {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        icon: row.get(3)?,
        sort_index: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        member_ids: vec![],
    })
}

pub fn get_all_skill_groups(&self) -> Result<Vec<SkillGroup>, AppError> {
    let conn = lock_conn!(self.conn);
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, icon, sort_index, created_at, updated_at
             FROM skill_groups ORDER BY COALESCE(sort_index, 9999), name ASC",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    let mut groups: Vec<SkillGroup> = stmt
        .query_map([], |row| Self::row_to_group(row))
        .map_err(|e| AppError::Database(e.to_string()))?
        .map(|r| r.map_err(|e| AppError::Database(e.to_string())))
        .collect::<Result<Vec<_>, _>>()?;

    let mut member_stmt = conn
        .prepare("SELECT group_id, skill_id FROM skill_group_members ORDER BY group_id")
        .map_err(|e| AppError::Database(e.to_string()))?;
    let pairs: Vec<(String, String)> = member_stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| AppError::Database(e.to_string()))?
        .map(|r| r.map_err(|e| AppError::Database(e.to_string())))
        .collect::<Result<Vec<_>, _>>()?;
    for group in &mut groups {
        group.member_ids = pairs
            .iter()
            .filter(|(gid, _)| gid == &group.id)
            .map(|(_, sid)| sid.clone())
            .collect();
    }
    Ok(groups)
}

pub fn get_skill_group(&self, id: &str) -> Result<Option<SkillGroup>, AppError> {
    let conn = lock_conn!(self.conn);
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, icon, sort_index, created_at, updated_at
             FROM skill_groups WHERE id = ?1",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    match stmt.query_row([id], |row| Self::row_to_group(row)) {
        Ok(g) => Ok(Some(g)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e.to_string())),
    }
}

pub fn create_skill_group(&self, group: &SkillGroup) -> Result<(), AppError> {
    let conn = lock_conn!(self.conn);
    conn.execute(
        "INSERT INTO skill_groups (id, name, description, icon, sort_index, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            group.id, group.name, group.description, group.icon,
            group.sort_index, group.created_at, group.updated_at,
        ],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

pub fn update_skill_group(&self, group: &SkillGroup) -> Result<(), AppError> {
    let conn = lock_conn!(self.conn);
    conn.execute(
        "UPDATE skill_groups SET name=?1, description=?2, icon=?3, sort_index=?4, updated_at=?5
         WHERE id=?6",
        params![
            group.name, group.description, group.icon,
            group.sort_index, group.updated_at, group.id,
        ],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}
```

- [ ] **Step 4: 删除 is_active 相关方法**

删除以下方法（整个函数体）：
- `set_skill_group_active`
- `get_active_skill_group_ids`

- [ ] **Step 5: 编译验证**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep "^error"
```

Expected: 会有编译错误，这是预期的——依赖这些方法的地方还没改。记录错误，继续下一 Task。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/database/dao/skill_groups.rs
git commit -m "refactor(db): remove SkillGroupApps and is_active from skill_groups DAO"
```

---

## Task 3: 新增 workspace bindings DAO

**Files:**
- Modify: `src-tauri/src/database/dao/workspaces.rs`（若不存在则在 `src-tauri/src/database/dao/` 下找到工作空间相关 DAO 文件）

先确认工作空间 DAO 在哪个文件：

- [ ] **Step 1: 找到工作空间 DAO 文件**

```bash
grep -rl "fn get_all_workspaces\|fn create_workspace" src-tauri/src/database/
```

Expected: 输出文件路径，如 `src-tauri/src/database/dao/workspaces.rs`

- [ ] **Step 2: 在 Database impl 中添加 workspace bindings 方法**

在找到的文件末尾的 `impl Database` 块中添加：

```rust
// ===== workspace_skill_bindings =====

pub fn get_workspace_skill_bindings(&self, workspace_id: &str) -> Result<Vec<String>, AppError> {
    let conn = lock_conn!(self.conn);
    let mut stmt = conn
        .prepare("SELECT skill_id FROM workspace_skill_bindings WHERE workspace_id = ?1")
        .map_err(|e| AppError::Database(e.to_string()))?;
    let rows = stmt
        .query_map([workspace_id], |row| row.get::<_, String>(0))
        .map_err(|e| AppError::Database(e.to_string()))?;
    rows.map(|r| r.map_err(|e| AppError::Database(e.to_string()))).collect()
}

pub fn toggle_workspace_skill(&self, workspace_id: &str, skill_id: &str, active: bool) -> Result<(), AppError> {
    let conn = lock_conn!(self.conn);
    if active {
        conn.execute(
            "INSERT OR IGNORE INTO workspace_skill_bindings (workspace_id, skill_id) VALUES (?1, ?2)",
            params![workspace_id, skill_id],
        )
    } else {
        conn.execute(
            "DELETE FROM workspace_skill_bindings WHERE workspace_id = ?1 AND skill_id = ?2",
            params![workspace_id, skill_id],
        )
    }
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

// ===== workspace_group_bindings =====

pub fn get_workspace_group_bindings(&self, workspace_id: &str) -> Result<Vec<String>, AppError> {
    let conn = lock_conn!(self.conn);
    let mut stmt = conn
        .prepare("SELECT group_id FROM workspace_group_bindings WHERE workspace_id = ?1")
        .map_err(|e| AppError::Database(e.to_string()))?;
    let rows = stmt
        .query_map([workspace_id], |row| row.get::<_, String>(0))
        .map_err(|e| AppError::Database(e.to_string()))?;
    rows.map(|r| r.map_err(|e| AppError::Database(e.to_string()))).collect()
}

pub fn toggle_workspace_group(&self, workspace_id: &str, group_id: &str, active: bool) -> Result<(), AppError> {
    let conn = lock_conn!(self.conn);
    if active {
        conn.execute(
            "INSERT OR IGNORE INTO workspace_group_bindings (workspace_id, group_id) VALUES (?1, ?2)",
            params![workspace_id, group_id],
        )
    } else {
        conn.execute(
            "DELETE FROM workspace_group_bindings WHERE workspace_id = ?1 AND group_id = ?2",
            params![workspace_id, group_id],
        )
    }
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

// ===== workspaces with is_user_level =====

pub fn get_all_workspaces_with_user_level(&self) -> Result<Vec<crate::database::dao::workspaces::Workspace>, AppError> {
    // 复用现有 get_all_workspaces，但需要确保返回 is_user_level 字段
    // 这里调用现有实现，如果 Workspace 结构体没有 is_user_level，在 Task 4 中添加
    self.get_all_workspaces()
}
```

注意：`params!` 宏需要 `use rusqlite::params;` 在文件顶部已有导入。

- [ ] **Step 3: 更新 Workspace 结构体加 is_user_level 字段**

找到 `Workspace` 结构体定义（通常在同文件或 `src-tauri/src/database/dao/workspaces.rs`），添加字段：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_user_level: bool,
    pub created_at: i64,
    pub updated_at: i64,
}
```

同时更新读取 Workspace 的 SQL 查询，加上 `is_user_level` 列（SELECT 和 row 映射）。

- [ ] **Step 4: 编译验证**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep "^error"
```

Expected: 错误减少，Workspace 相关错误消失

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/database/dao/
git commit -m "feat(db): add workspace_skill_bindings and workspace_group_bindings DAO methods"
```

---

## Task 4: 重写 WorkspaceSkillService

**Files:**
- Modify: `src-tauri/src/services/workspace_skill.rs`

- [ ] **Step 1: 用新实现替换整个文件**

```rust
//! 工作空间 Skill 同步服务

use crate::database::Database;
use crate::services::skill::SkillService;
use anyhow::{anyhow, Result};
use std::sync::Arc;

pub struct WorkspaceSkillService;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBindings {
    pub group_ids: Vec<String>,
    pub skill_ids: Vec<String>,
    pub total_skill_count: usize,
}

impl WorkspaceSkillService {
    /// 切换工作空间绑定分组，并触发同步
    pub fn toggle_group(db: &Arc<Database>, workspace_id: &str, group_id: &str, active: bool) -> Result<()> {
        db.toggle_workspace_group(workspace_id, group_id, active)
            .map_err(|e| anyhow!("{e}"))?;
        Self::sync_workspace(db, workspace_id)
    }

    /// 切换工作空间直绑 skill，并触发同步
    pub fn toggle_skill(db: &Arc<Database>, workspace_id: &str, skill_id: &str, active: bool) -> Result<()> {
        db.toggle_workspace_skill(workspace_id, skill_id, active)
            .map_err(|e| anyhow!("{e}"))?;
        Self::sync_workspace(db, workspace_id)
    }

    /// 获取工作空间绑定详情（分组 ids、直绑 skill ids、并集技能总数）
    pub fn get_bindings(db: &Arc<Database>, workspace_id: &str) -> Result<WorkspaceBindings> {
        let group_ids = db.get_workspace_group_bindings(workspace_id)
            .map_err(|e| anyhow!("{e}"))?;
        let skill_ids = db.get_workspace_skill_bindings(workspace_id)
            .map_err(|e| anyhow!("{e}"))?;

        // 计算并集技能数
        let mut all_skill_ids: std::collections::HashSet<String> = skill_ids.iter().cloned().collect();
        for gid in &group_ids {
            let members = db.get_group_member_ids(gid).map_err(|e| anyhow!("{e}"))?;
            all_skill_ids.extend(members);
        }

        Ok(WorkspaceBindings {
            group_ids,
            skill_ids,
            total_skill_count: all_skill_ids.len(),
        })
    }

    /// 核心同步：计算工作空间 skill 并集，全量同步到文件系统
    /// 并集 = 直绑 skill ∪ 所有绑定分组的成员
    /// 每个 skill 同步的 app 目录 = skill.apps.enabled_apps()
    pub fn sync_workspace(db: &Arc<Database>, workspace_id: &str) -> Result<()> {
        let workspace = db.get_workspace(workspace_id)
            .map_err(|e| anyhow!("{e}"))?
            .ok_or_else(|| anyhow!("工作空间不存在: {workspace_id}"))?;

        // 计算 skill 并集
        let group_ids = db.get_workspace_group_bindings(workspace_id)
            .map_err(|e| anyhow!("{e}"))?;
        let direct_skill_ids = db.get_workspace_skill_bindings(workspace_id)
            .map_err(|e| anyhow!("{e}"))?;

        let mut skill_ids: std::collections::HashSet<String> =
            direct_skill_ids.into_iter().collect();
        for gid in &group_ids {
            let members = db.get_group_member_ids(gid).map_err(|e| anyhow!("{e}"))?;
            skill_ids.extend(members);
        }

        // 用户级别空间同步到全局 app 目录，项目空间同步到局部目录
        if workspace.is_user_level {
            Self::sync_skills_to_global(db, &skill_ids)?;
        } else {
            Self::sync_skills_to_path(db, &skill_ids, &workspace.path)?;
        }

        Ok(())
    }

    /// 当分组成员变化时，同步所有绑定该分组的工作空间
    pub fn sync_workspaces_for_group(db: &Arc<Database>, group_id: &str) -> Result<()> {
        let workspace_ids = db.get_workspaces_with_group_binding(group_id)
            .map_err(|e| anyhow!("{e}"))?;
        for workspace_id in &workspace_ids {
            if let Err(e) = Self::sync_workspace(db, workspace_id) {
                log::warn!("sync_workspaces_for_group: 工作空间 {workspace_id} 同步失败: {e}");
            }
        }
        Ok(())
    }

    fn sync_skills_to_global(db: &Arc<Database>, skill_ids: &std::collections::HashSet<String>) -> Result<()> {
        SkillService::disable_all_skills(db)?;
        for skill_id in skill_ids {
            if let Ok(Some(skill)) = db.get_installed_skill(skill_id) {
                for app in skill.apps.enabled_apps() {
                    if let Err(e) = SkillService::sync_to_app_dir(&skill.directory, &app) {
                        log::warn!("sync_global: skill {} to {:?} 失败: {e}", skill.name, app);
                    }
                }
            }
        }
        Ok(())
    }

    fn sync_skills_to_path(db: &Arc<Database>, skill_ids: &std::collections::HashSet<String>, workspace_path: &str) -> Result<()> {
        use crate::app_config::AppType;
        use std::path::PathBuf;

        let home = dirs::home_dir().ok_or_else(|| anyhow!("无法获取 home 目录"))?;
        let base = PathBuf::from(workspace_path);

        // 各 app 的局部 skills 目录
        let app_dirs: Vec<(AppType, PathBuf)> = vec![
            (AppType::Claude,   base.join(".claude").join("skills")),
            (AppType::Codex,    base.join(".codex").join("skills")),
            (AppType::Gemini,   base.join(".gemini").join("skills")),
            (AppType::OpenCode, base.join(".config").join("opencode").join("skills")),
            (AppType::Hermes,   crate::hermes_config::get_hermes_dir().join("skills")), // hermes 无局部目录，跳过
        ];

        let ssot_dir = SkillService::get_ssot_dir()?;

        // 清空所有局部 skills 目录中由本应用管理的 symlink/目录
        for (_, dir) in &app_dirs {
            if dir.exists() {
                for entry in std::fs::read_dir(dir)? {
                    let entry = entry?;
                    let path = entry.path();
                    if path.is_symlink() || path.is_dir() {
                        let _ = if path.is_symlink() || path.is_file() {
                            std::fs::remove_file(&path)
                        } else {
                            std::fs::remove_dir_all(&path)
                        };
                    }
                }
            }
        }

        // 同步
        for skill_id in skill_ids {
            if let Ok(Some(skill)) = db.get_installed_skill(skill_id) {
                let source = ssot_dir.join(&skill.directory);
                if !source.exists() {
                    continue;
                }
                for app in skill.apps.enabled_apps() {
                    let dest_dir = match app {
                        AppType::Claude   => base.join(".claude").join("skills"),
                        AppType::Codex    => base.join(".codex").join("skills"),
                        AppType::Gemini   => base.join(".gemini").join("skills"),
                        AppType::OpenCode => base.join(".config").join("opencode").join("skills"),
                        AppType::Hermes | AppType::OpenClaw => continue, // 无局部目录
                    };
                    let _ = std::fs::create_dir_all(&dest_dir);
                    let dest = dest_dir.join(&skill.directory);
                    if dest.exists() || dest.is_symlink() {
                        let _ = if dest.is_symlink() || dest.is_file() {
                            std::fs::remove_file(&dest)
                        } else {
                            std::fs::remove_dir_all(&dest)
                        };
                    }
                    #[cfg(unix)]
                    {
                        let _ = std::os::unix::fs::symlink(&source, &dest);
                    }
                    #[cfg(windows)]
                    {
                        let _ = std::os::windows::fs::symlink_dir(&source, &dest);
                    }
                }
            }
        }
        Ok(())
    }
}
```

- [ ] **Step 2: 在 workspaces DAO 中添加 get_workspaces_with_group_binding**

在 workspaces DAO 文件中添加：

```rust
pub fn get_workspaces_with_group_binding(&self, group_id: &str) -> Result<Vec<String>, AppError> {
    let conn = lock_conn!(self.conn);
    let mut stmt = conn
        .prepare("SELECT workspace_id FROM workspace_group_bindings WHERE group_id = ?1")
        .map_err(|e| AppError::Database(e.to_string()))?;
    let rows = stmt
        .query_map([group_id], |row| row.get::<_, String>(0))
        .map_err(|e| AppError::Database(e.to_string()))?;
    rows.map(|r| r.map_err(|e| AppError::Database(e.to_string()))).collect()
}
```

- [ ] **Step 3: 在 workspaces DAO 中添加 get_workspace 单条查询**

```rust
pub fn get_workspace(&self, id: &str) -> Result<Option<Workspace>, AppError> {
    let conn = lock_conn!(self.conn);
    let mut stmt = conn
        .prepare(
            "SELECT id, name, path, is_user_level, created_at, updated_at
             FROM workspaces WHERE id = ?1",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    match stmt.query_row([id], |row| {
        Ok(Workspace {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            is_user_level: row.get::<_, i64>(3)? != 0,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    }) {
        Ok(w) => Ok(Some(w)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e.to_string())),
    }
}
```

同时更新 `get_all_workspaces` 的 SQL 和 row 映射，加上 `is_user_level` 字段（SELECT 列和结构体映射）。

- [ ] **Step 4: 编译验证**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep "^error"
```

Expected: 错误继续减少

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/workspace_skill.rs src-tauri/src/database/dao/
git commit -m "feat(service): rewrite WorkspaceSkillService with unified sync_workspace"
```

---

## Task 5: 简化 SkillGroupService 和更新命令层

**Files:**
- Modify: `src-tauri/src/services/skill_group.rs`
- Modify: `src-tauri/src/commands/skill_group.rs`
- Modify: `src-tauri/src/commands/workspace_skill.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 重写 skill_group.rs service**

```rust
//! SkillGroup 业务逻辑层

use crate::database::dao::skill_groups::SkillGroup;
use crate::database::Database;
use crate::services::workspace_skill::WorkspaceSkillService;
use anyhow::{anyhow, Result};
use chrono::Utc;
use std::sync::Arc;
use uuid::Uuid;

pub struct SkillGroupService;

impl SkillGroupService {
    pub fn create(db: &Arc<Database>, name: String, description: Option<String>) -> Result<SkillGroup> {
        let now = Utc::now().timestamp();
        let group = SkillGroup {
            id: Uuid::new_v4().to_string(),
            name,
            description,
            icon: None,
            sort_index: None,
            created_at: now,
            updated_at: now,
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
        member_ids: Vec<String>,
    ) -> Result<SkillGroup> {
        let mut group = db
            .get_skill_group(id)?
            .ok_or_else(|| anyhow!("分组不存在: {id}"))?;
        group.name = name;
        group.description = description;
        group.updated_at = Utc::now().timestamp();
        db.update_skill_group(&group)?;
        db.set_group_members(id, &member_ids)?;
        // 同步所有绑定该分组的工作空间
        if let Err(e) = WorkspaceSkillService::sync_workspaces_for_group(db, id) {
            log::warn!("update_skill_group: 工作空间同步失败: {e}");
        }
        group.member_ids = member_ids;
        Ok(group)
    }
}
```

- [ ] **Step 2: 重写 commands/skill_group.rs**

```rust
//! 技能分组命令层

use crate::database::dao::skill_groups::SkillGroup;
use crate::services::skill_group::SkillGroupService;
use crate::store::AppState;
use tauri::State;

#[tauri::command]
pub fn get_skill_groups(app_state: State<'_, AppState>) -> Result<Vec<SkillGroup>, String> {
    app_state.db.get_all_skill_groups().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_skill_group(
    name: String,
    description: Option<String>,
    app_state: State<'_, AppState>,
) -> Result<SkillGroup, String> {
    SkillGroupService::create(&app_state.db, name, description).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_skill_group(
    id: String,
    name: String,
    description: Option<String>,
    member_ids: Vec<String>,
    app_state: State<'_, AppState>,
) -> Result<SkillGroup, String> {
    SkillGroupService::update(&app_state.db, &id, name, description, member_ids)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_skill_group(id: String, app_state: State<'_, AppState>) -> Result<(), String> {
    app_state.db.delete_skill_group(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_group_member_ids(
    group_id: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    app_state.db.get_group_member_ids(&group_id).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: 重写 commands/workspace_skill.rs**

```rust
//! 工作空间命令层

use crate::database::dao::workspaces::Workspace;
use crate::services::workspace_skill::{WorkspaceBindings, WorkspaceSkillService};
use crate::store::AppState;
use tauri::State;

#[tauri::command]
pub fn get_workspaces(app_state: State<'_, AppState>) -> Result<Vec<Workspace>, String> {
    app_state.db.get_all_workspaces().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_workspace(
    name: String,
    path: String,
    app_state: State<'_, AppState>,
) -> Result<Workspace, String> {
    // 不允许路径为 ~
    if path.trim() == "~" {
        return Err("路径不能为 ~（保留给用户级别空间）".to_string());
    }
    app_state.db.create_workspace(&name, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_workspace(
    id: String,
    name: String,
    path: String,
    app_state: State<'_, AppState>,
) -> Result<Workspace, String> {
    // 用户级别空间不能修改路径
    if let Ok(Some(ws)) = app_state.db.get_workspace(&id) {
        if ws.is_user_level && path.trim() != "~" {
            return Err("用户级别空间路径不可修改".to_string());
        }
    }
    app_state.db.update_workspace(&id, &name, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_workspace(id: String, app_state: State<'_, AppState>) -> Result<(), String> {
    if let Ok(Some(ws)) = app_state.db.get_workspace(&id) {
        if ws.is_user_level {
            return Err("用户级别空间不可删除".to_string());
        }
    }
    app_state.db.delete_workspace(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_workspace_bindings(
    workspace_id: String,
    app_state: State<'_, AppState>,
) -> Result<WorkspaceBindings, String> {
    WorkspaceSkillService::get_bindings(&app_state.db, &workspace_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_workspace_group(
    workspace_id: String,
    group_id: String,
    active: bool,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    WorkspaceSkillService::toggle_group(&app_state.db, &workspace_id, &group_id, active)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_workspace_skill(
    workspace_id: String,
    skill_id: String,
    active: bool,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    WorkspaceSkillService::toggle_skill(&app_state.db, &workspace_id, &skill_id, active)
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 4: 更新 lib.rs 中的命令注册**

在 `src-tauri/src/lib.rs` 的 `tauri::generate_handler!` 中：

删除：
```
commands::set_group_active,
commands::add_skill_to_group,
commands::remove_skill_from_group,
commands::add_group_to_workspace,
commands::remove_group_from_workspace,
commands::get_workspace_group_ids,
commands::toggle_group_in_workspace,
commands::get_workspace_active_group_ids,
```

添加：
```
commands::get_workspace_bindings,
commands::toggle_workspace_group,
commands::toggle_workspace_skill,
```

- [ ] **Step 5: 编译，修复所有剩余错误**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep "^error"
```

逐一修复报错（主要是 use 路径、函数签名不匹配）。

- [ ] **Step 6: 编译通过后 Commit**

```bash
git add src-tauri/src/services/skill_group.rs src-tauri/src/commands/skill_group.rs src-tauri/src/commands/workspace_skill.rs src-tauri/src/lib.rs
git commit -m "refactor(backend): simplify SkillGroupService, unify workspace command layer"
```

---

## Task 6: 更新前端 API 和 Hooks

**Files:**
- Modify: `src/lib/api/skills.ts`
- Modify: `src/lib/api/skillGroups.ts`
- Modify: `src/lib/api/workspaces.ts`
- Modify: `src/hooks/useSkillGroups.ts`
- Modify: `src/hooks/useWorkspaces.ts`

- [ ] **Step 1: 更新 src/lib/api/skills.ts 中的 SkillGroup 类型**

找到并替换 `SkillGroup` 和 `SkillGroupApps` 定义：

```typescript
// 删除 SkillGroupApps 接口

export interface SkillGroup {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  sortIndex?: number;
  createdAt: number;
  updatedAt: number;
  memberIds: string[];
}
```

- [ ] **Step 2: 更新 src/lib/api/skillGroups.ts**

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { SkillGroup } from "@/lib/api/skills";

export const skillGroupsApi = {
  getAll: (): Promise<SkillGroup[]> => invoke("get_skill_groups"),

  create: (params: {
    name: string;
    description?: string;
  }): Promise<SkillGroup> =>
    invoke("create_skill_group", {
      name: params.name,
      description: params.description ?? null,
    }),

  update: (params: {
    id: string;
    name: string;
    description?: string;
    memberIds: string[];
  }): Promise<SkillGroup> =>
    invoke("update_skill_group", {
      id: params.id,
      name: params.name,
      description: params.description ?? null,
      memberIds: params.memberIds,
    }),

  delete: (id: string): Promise<void> => invoke("delete_skill_group", { id }),

  getMemberIds: (groupId: string): Promise<string[]> =>
    invoke("get_group_member_ids", { groupId }),
};
```

- [ ] **Step 3: 更新 src/lib/api/workspaces.ts**

```typescript
import { invoke } from "@tauri-apps/api/core";

export interface Workspace {
  id: string;
  name: string;
  path: string;
  isUserLevel: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceBindings {
  groupIds: string[];
  skillIds: string[];
  totalSkillCount: number;
}

export const workspacesApi = {
  getAll: (): Promise<Workspace[]> => invoke("get_workspaces"),

  create: (params: { name: string; path: string }): Promise<Workspace> =>
    invoke("create_workspace", params),

  update: (params: { id: string; name: string; path: string }): Promise<Workspace> =>
    invoke("update_workspace", params),

  delete: (id: string): Promise<void> => invoke("delete_workspace", { id }),

  getBindings: (workspaceId: string): Promise<WorkspaceBindings> =>
    invoke("get_workspace_bindings", { workspaceId }),

  toggleGroup: (workspaceId: string, groupId: string, active: boolean): Promise<void> =>
    invoke("toggle_workspace_group", { workspaceId, groupId, active }),

  toggleSkill: (workspaceId: string, skillId: string, active: boolean): Promise<void> =>
    invoke("toggle_workspace_skill", { workspaceId, skillId, active }),
};
```

- [ ] **Step 4: 更新 src/hooks/useSkillGroups.ts**

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { skillGroupsApi } from "@/lib/api/skillGroups";

export function useSkillGroups() {
  return useQuery({
    queryKey: ["skillGroups"],
    queryFn: () => skillGroupsApi.getAll(),
    staleTime: Infinity,
  });
}

export function useGroupMemberIds(groupId: string | null) {
  return useQuery({
    queryKey: ["skillGroups", "members", groupId],
    queryFn: () => skillGroupsApi.getMemberIds(groupId!),
    enabled: !!groupId,
    staleTime: Infinity,
  });
}

export function useCreateSkillGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: skillGroupsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skillGroups"] }),
  });
}

export function useUpdateSkillGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: skillGroupsApi.update,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skillGroups"] });
      qc.invalidateQueries({ queryKey: ["skills", "installed"] });
    },
  });
}

export function useDeleteSkillGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => skillGroupsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skillGroups"] }),
  });
}
```

- [ ] **Step 5: 更新 src/hooks/useWorkspaces.ts**

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workspacesApi } from "@/lib/api/workspaces";

export function useWorkspaces() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: () => workspacesApi.getAll(),
    staleTime: Infinity,
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: workspacesApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

export function useUpdateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: workspacesApi.update,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workspacesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

export function useWorkspaceBindings(workspaceId: string | null) {
  return useQuery({
    queryKey: ["workspaces", "bindings", workspaceId],
    queryFn: () => workspacesApi.getBindings(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 0,
  });
}

export function useToggleWorkspaceGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, groupId, active }: { workspaceId: string; groupId: string; active: boolean }) =>
      workspacesApi.toggleGroup(workspaceId, groupId, active),
    onSuccess: (_data, { workspaceId }) => {
      qc.invalidateQueries({ queryKey: ["workspaces", "bindings", workspaceId] });
      qc.invalidateQueries({ queryKey: ["skills", "installed"] });
    },
  });
}

export function useToggleWorkspaceSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, skillId, active }: { workspaceId: string; skillId: string; active: boolean }) =>
      workspacesApi.toggleSkill(workspaceId, skillId, active),
    onSuccess: (_data, { workspaceId }) => {
      qc.invalidateQueries({ queryKey: ["workspaces", "bindings", workspaceId] });
      qc.invalidateQueries({ queryKey: ["skills", "installed"] });
    },
  });
}
```

- [ ] **Step 6: 类型检查**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: 会有错误（组件层还没改），记录继续

- [ ] **Step 7: Commit**

```bash
git add src/lib/api/ src/hooks/
git commit -m "refactor(frontend): update API types and hooks for new workspace/group model"
```

---

## Task 7: 重构 SkillGroupsPanel 和 SkillGroupEditDialog

**Files:**
- Modify: `src/components/skills/SkillGroupsPanel.tsx`
- Modify: `src/components/skills/SkillGroupEditDialog.tsx`

- [ ] **Step 1: 重写 SkillGroupsPanel.tsx**

```tsx
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Plus, Edit2, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SkillGroupEditDialog } from "./SkillGroupEditDialog";
import {
  useSkillGroups,
  useCreateSkillGroup,
  useUpdateSkillGroup,
  useDeleteSkillGroup,
} from "@/hooks/useSkillGroups";
import type { SkillGroup } from "@/lib/api/skills";

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

  const handleSave = async (params: { name: string; description?: string; memberIds: string[] }) => {
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
          {t("skillGroups.description", "将 Skill 按场景分组，在工作空间中一键绑定")}
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
        <div className="space-y-2">
          {groups.map((group) => (
            <div
              key={group.id}
              className="flex items-center gap-4 rounded-lg px-4 py-3 border border-border-default"
            >
              <div className="flex-1 min-w-0">
                <span className="font-medium text-sm">{group.name}</span>
                {group.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {group.description}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("skillGroups.memberCount", "{{count}} 个 Skill", { count: group.memberIds.length })}
                </p>
              </div>
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

- [ ] **Step 2: 重写 SkillGroupEditDialog.tsx**

```tsx
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Search } from "lucide-react";
import { useInstalledSkills } from "@/hooks/useSkills";
import { useGroupMemberIds } from "@/hooks/useSkillGroups";
import type { SkillGroup } from "@/lib/api/skills";

interface Props {
  open: boolean;
  group: SkillGroup | null;
  onClose: () => void;
  onSave: (params: { name: string; description?: string; memberIds: string[] }) => void;
  saving?: boolean;
}

export function SkillGroupEditDialog({ open, group, onClose, onSave, saving }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [draftMemberIds, setDraftMemberIds] = useState<Set<string>>(new Set());

  const { data: installedSkills = [] } = useInstalledSkills();
  const { data: memberIds = [] } = useGroupMemberIds(group?.id ?? null);

  useEffect(() => {
    if (open) {
      setName(group?.name ?? "");
      setDescription(group?.description ?? "");
      setSearch("");
      setDraftMemberIds(new Set(memberIds));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group]);

  useEffect(() => {
    if (open && memberIds.length > 0) {
      setDraftMemberIds(new Set(memberIds));
    }
  }, [memberIds, open]);

  const filtered = installedSkills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.description ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const toggleMember = (skillId: string, checked: boolean) => {
    setDraftMemberIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(skillId);
      else next.delete(skillId);
      return next;
    });
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      memberIds: Array.from(draftMemberIds),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" zIndex="top">
        <DialogHeader>
          <DialogTitle>
            {group ? t("skillGroups.edit", "编辑分组") : t("skillGroups.create", "新建分组")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 min-h-0">
          <Input
            placeholder={t("skillGroups.namePlaceholder", "分组名称")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Textarea
            placeholder={t("skillGroups.descriptionPlaceholder", "描述（可选）")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />

          {group && (
            <div className="space-y-2">
              <div className="text-sm font-medium">
                {t("skillGroups.selectSkills", "选择 Skill")}
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("skillGroups.searchSkills", "搜索 Skill")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <div className="space-y-1 border rounded-md p-2 max-h-60 overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-2 text-center">
                    {t("skillGroups.noSkills", "没有已安装的 Skill")}
                  </div>
                ) : (
                  filtered.map((skill) => {
                    const checked = draftMemberIds.has(skill.id);
                    return (
                      <label
                        key={skill.id}
                        className="flex items-start gap-2 cursor-pointer rounded px-1 py-1 hover:bg-accent"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => toggleMember(skill.id, !!v)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{skill.name}</div>
                          {skill.description && (
                            <div className="text-xs text-muted-foreground truncate">
                              {skill.description}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel", "取消")}
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("common.save", "保存")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: 类型检查**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/components/skills/SkillGroupsPanel.tsx src/components/skills/SkillGroupEditDialog.tsx
git commit -m "refactor(ui): simplify SkillGroupsPanel - remove apps toggle and active checkbox"
```

---

## Task 8: 重构 WorkspacesPanel

**Files:**
- Modify: `src/components/skills/WorkspacesPanel.tsx`

- [ ] **Step 1: 重写 WorkspacesPanel.tsx**

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
  useWorkspaceBindings,
  useToggleWorkspaceGroup,
  useToggleWorkspaceSkill,
} from "@/hooks/useWorkspaces";
import { useSkillGroups } from "@/hooks/useSkillGroups";
import { useInstalledSkills } from "@/hooks/useSkills";
import type { Workspace } from "@/lib/api/workspaces";

function WorkspaceBindingsPanel({ workspace }: { workspace: Workspace }) {
  const { t } = useTranslation();
  const { data: groups = [] } = useSkillGroups();
  const { data: skills = [] } = useInstalledSkills();
  const { data: bindings } = useWorkspaceBindings(workspace.id);
  const toggleGroupMutation = useToggleWorkspaceGroup();
  const toggleSkillMutation = useToggleWorkspaceSkill();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const boundGroupIds = new Set(bindings?.groupIds ?? []);
  const boundSkillIds = new Set(bindings?.skillIds ?? []);

  const handleToggleGroup = async (groupId: string, checked: boolean) => {
    setPendingId(groupId);
    try {
      await toggleGroupMutation.mutateAsync({ workspaceId: workspace.id, groupId, active: checked });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    } finally {
      setPendingId(null);
    }
  };

  const handleToggleSkill = async (skillId: string, checked: boolean) => {
    setPendingId(skillId);
    try {
      await toggleSkillMutation.mutateAsync({ workspaceId: workspace.id, skillId, active: checked });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="border-t border-border-default bg-muted/20 px-4 py-3 space-y-3">
      {/* 分组区 */}
      {groups.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1.5">
            {t("workspaces.bindGroups", "绑定分组")}
          </div>
          <div className="space-y-1">
            {groups.map((group) => {
              const checked = boundGroupIds.has(group.id);
              return (
                <label
                  key={group.id}
                  className="flex items-center gap-2 cursor-pointer rounded px-1 py-1.5 hover:bg-accent"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => handleToggleGroup(group.id, !!v)}
                    disabled={pendingId === group.id}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{group.name}</div>
                    {group.description && (
                      <div className="text-xs text-muted-foreground truncate">{group.description}</div>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {t("skillGroups.memberCount", "{{count}} 个 Skill", { count: group.memberIds.length })}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* 单独 Skill 区 */}
      {skills.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1.5">
            {t("workspaces.bindSkills", "单独绑定 Skill")}
          </div>
          <div className="space-y-1">
            {skills.map((skill) => {
              const checked = boundSkillIds.has(skill.id);
              return (
                <label
                  key={skill.id}
                  className="flex items-center gap-2 cursor-pointer rounded px-1 py-1.5 hover:bg-accent"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => handleToggleSkill(skill.id, !!v)}
                    disabled={pendingId === skill.id}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">{skill.name}</div>
                    {skill.description && (
                      <div className="text-xs text-muted-foreground truncate">{skill.description}</div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {groups.length === 0 && skills.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-2">
          {t("workspaces.noSkillsOrGroups", "还没有分组或 Skill，请先安装")}
        </div>
      )}

      {/* 汇总 */}
      {bindings && (
        <div className="text-xs text-muted-foreground pt-1 border-t border-border-default">
          {t("workspaces.totalSkills", "共 {{count}} 个 Skill 将被同步", { count: bindings.totalSkillCount })}
        </div>
      )}
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

  const userLevelWs = workspaces.find((ws) => ws.isUserLevel);
  const projectWorkspaces = workspaces.filter((ws) => !ws.isUserLevel);

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

  const renderWorkspace = (ws: Workspace, isUserLevel: boolean) => {
    const expanded = expandedId === ws.id;
    return (
      <div key={ws.id} className={`rounded-lg border overflow-hidden ${isUserLevel ? "border-primary/30 bg-primary/5" : "border-border-default"}`}>
        <div
          className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 select-none"
          onClick={() => toggleExpand(ws.id)}
        >
          {expanded
            ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          }
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm flex items-center gap-2">
              {ws.name}
              {isUserLevel && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-normal">
                  {t("workspaces.userLevel", "用户级别")}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground truncate mt-0.5">{ws.path}</div>
          </div>
          <div
            className="flex items-center gap-1 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {!isUserLevel && (
              <>
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
              </>
            )}
          </div>
        </div>
        {expanded && <WorkspaceBindingsPanel workspace={ws} />}
      </div>
    );
  };

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

      <div className="space-y-2">
        {/* 用户级别空间置顶 */}
        {userLevelWs && renderWorkspace(userLevelWs, true)}

        {/* 项目空间 */}
        {projectWorkspaces.length === 0 && !userLevelWs ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            {t("workspaces.empty", "还没有工作空间，点击「新建工作空间」开始")}
          </div>
        ) : (
          projectWorkspaces.map((ws) => renderWorkspace(ws, false))
        )}
      </div>

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

- [ ] **Step 2: 更新 WorkspaceEditDialog 路径校验**

在 `src/components/skills/WorkspaceEditDialog.tsx` 中，找到表单提交处理，添加路径校验：

```typescript
// 在 handleSave 或 onSubmit 中添加：
if (path.trim() === "~") {
  // 显示错误提示
  setError("path", { message: t("workspaces.pathCannotBeHome", "路径不能为 ~") });
  return;
}
```

- [ ] **Step 3: 类型检查**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: 无错误或只有不相关的警告

- [ ] **Step 4: Commit**

```bash
git add src/components/skills/WorkspacesPanel.tsx src/components/skills/WorkspaceEditDialog.tsx
git commit -m "feat(ui): rewrite WorkspacesPanel with user-level workspace and skill/group bindings"
```

---

## Task 9: 更新 UnifiedSkillsPanel 和导入已有逻辑

**Files:**
- Modify: `src/components/skills/UnifiedSkillsPanel.tsx`

- [ ] **Step 1: 移除 activeGroups 提示条相关代码**

在 `UnifiedSkillsPanel.tsx` 中找到并删除以下代码：

```typescript
// 删除
const activeGroups = groups.filter((g) => g.isActive);
```

```tsx
{/* 删除这整个 activeGroups 提示条 */}
{activeGroups.length > 0 && activeTab === "installed" && (
  <div className="flex items-center gap-2 mb-2 pl-3 pr-2 py-1.5 border-l-2 border-primary text-sm">
    ...
  </div>
)}
```

- [ ] **Step 2: 更新导入已有逻辑，绑定到用户级别空间**

在 `UnifiedSkillsPanel.tsx` 中找到 `handleImport` 函数，在导入成功后添加绑定到用户级别空间的逻辑：

```typescript
const handleImport = async (imports: ImportSkillSelection[]) => {
  try {
    const imported = await importMutation.mutateAsync(imports);
    setImportDialogOpen(false);
    // 将导入的 skill 绑定到用户级别空间
    for (const skill of imported) {
      try {
        await invoke("toggle_workspace_skill", {
          workspaceId: "user",
          skillId: skill.id,
          active: true,
        });
      } catch (e) {
        log.warn(`绑定 skill ${skill.name} 到用户级别空间失败: ${e}`);
      }
    }
    toast.success(t("skills.importSuccess", { count: imported.length }), {
      closeButton: true,
    });
  } catch (error) {
    toast.error(t("common.error"), { description: String(error) });
  }
};
```

注意：`invoke` 从 `@tauri-apps/api/core` 导入。

- [ ] **Step 3: 编译和类型检查**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep "^error"
npx tsc --noEmit 2>&1 | head -20
```

Expected: 两者均无错误

- [ ] **Step 4: Commit**

```bash
git add src/components/skills/UnifiedSkillsPanel.tsx
git commit -m "feat(ui): bind imported skills to user-level workspace, remove group active banner"
```

---

## Task 10: 端到端验证

- [ ] **Step 1: 启动开发服务**

```bash
npm run tauri dev
```

- [ ] **Step 2: 验证数据库迁移**

打开应用，确认：
- 应用正常启动，无崩溃
- 工作空间 Tab 顶部出现「用户级别」空间（不可删除）
- 旧有的项目工作空间仍然存在

- [ ] **Step 3: 验证分组 Tab**

- 新建分组：只有名称/描述/成员，无 apps toggle，无激活 checkbox
- 编辑分组：勾选成员为草稿，点保存才生效
- 分组卡片显示成员数量

- [ ] **Step 4: 验证工作空间 Tab**

- 展开用户级别空间：显示分组区和单独 Skill 区
- 勾选分组：即时生效，`~/.claude/skills/` 中出现对应 skill 的 symlink
- 取消勾选：symlink 消失
- 同时勾选一个分组和一个单独 skill：两者并集都被同步
- 汇总行显示正确数量

- [ ] **Step 5: 验证新建项目工作空间**

- 新建路径为某项目目录（如 `/tmp/test-project`）
- 勾选分组后，`/tmp/test-project/.claude/skills/` 出现对应 symlink
- 路径填 `~` 时前端报错，无法提交

- [ ] **Step 6: 验证导入已有**

- 点击「导入已有」，导入一个 skill
- 用户级别空间展开后，该 skill 在「单独绑定 Skill」区自动被勾选

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: final verification pass for skills management redesign"
```

---

## 自检

**Spec 覆盖检查：**
- ✅ 数据库迁移（workspace_skill_bindings, workspace_group_bindings, is_user_level）→ Task 1
- ✅ skill_groups 表删除 is_active 和 enabled_* → Task 1 + Task 2
- ✅ WorkspaceSkillService 重写 sync_workspace → Task 4
- ✅ 分组 Tab 移除 apps/激活 → Task 7
- ✅ 工作空间 Tab 用户级别置顶、分组区+Skill区、即时同步 → Task 8
- ✅ 导入已有绑定到用户级别空间 → Task 9
- ✅ 新建工作空间路径不能为 ~ → Task 5 + Task 8
- ✅ 删除工作空间拦截用户级别 → Task 5
