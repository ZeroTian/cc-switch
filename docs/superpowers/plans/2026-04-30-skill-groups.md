# Skill Groups 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 cc-switch 添加技能分组功能，用户可创建场景分组（如"写作模式"），手动切换激活的分组，一键改变当前生效的 Skill 集合。

**Architecture:** 后端新增两张 SQLite 表（skill_groups / skill_group_members）+ Tauri 命令层 + 服务层；前端在 Skills 页新增"分组"标签页，SkillCard 显示所属分组 badge，激活状态在顶部提示条展示。激活一个组时独占模式：先禁用所有 skill，再按该组成员的原有 per-app 开关重新同步文件系统。

**Tech Stack:** Rust（rusqlite、tauri）、TypeScript（React、@tanstack/react-query、@tauri-apps/api）、shadcn/ui 组件

---

## 文件变更清单

### 新增
- `src-tauri/src/commands/skill_group.rs` — Tauri 命令层
- `src-tauri/src/database/dao/skill_groups.rs` — DAO 层（CRUD + 查询）
- `src-tauri/src/services/skill_group.rs` — 业务逻辑（激活/停用）
- `src/lib/api/skillGroups.ts` — 前端 API 封装（invoke 调用）
- `src/hooks/useSkillGroups.ts` — React Query hooks
- `src/components/skills/SkillGroupsPanel.tsx` — 分组列表面板
- `src/components/skills/SkillGroupEditDialog.tsx` — 新建/编辑分组弹窗

### 修改
- `src-tauri/src/database/schema.rs` — 新增两张表定义 + v10→v11 migration + SCHEMA_VERSION = 11
- `src-tauri/src/database/dao/mod.rs` — 注册新 DAO 模块
- `src-tauri/src/services/mod.rs` — 导出新服务
- `src-tauri/src/commands/mod.rs` — 注册新命令模块
- `src-tauri/src/lib.rs` — invoke_handler 添加新命令
- `src/components/skills/UnifiedSkillsPanel.tsx` — 新增"分组"标签页 + 激活提示条
- `src/components/skills/SkillCard.tsx`（发现列表用）→ 此 SkillCard 是发现面板专用，不改
- `src/lib/api/skills.ts` — 添加 SkillGroup / SkillGroupMember 类型

---

## Task 1: 数据库 schema — 新增两张表 + migration

**Files:**
- Modify: `src-tauri/src/database/schema.rs`
- Modify: `src-tauri/src/database/mod.rs`

- [ ] **Step 1: 在 `create_tables_on_conn` 末尾（`session_log_sync` 表之后）新增两张表**

打开 `src-tauri/src/database/schema.rs`，在现有最后一个 `CREATE TABLE IF NOT EXISTS` 块之后，追加：

```rust
        // 技能组定义表
        conn.execute(
            "CREATE TABLE IF NOT EXISTS skill_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                icon TEXT,
                is_active BOOLEAN NOT NULL DEFAULT 0,
                sort_index INTEGER,
                created_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        // 技能与分组多对多关联表
        conn.execute(
            "CREATE TABLE IF NOT EXISTS skill_group_members (
                group_id TEXT NOT NULL,
                skill_id TEXT NOT NULL,
                PRIMARY KEY (group_id, skill_id),
                FOREIGN KEY (group_id) REFERENCES skill_groups(id) ON DELETE CASCADE,
                FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
            )",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
```

- [ ] **Step 2: 将 `SCHEMA_VERSION` 从 10 升到 11**

在 `src-tauri/src/database/mod.rs` 第 47 行：

```rust
// 修改前
pub(crate) const SCHEMA_VERSION: i32 = 10;

// 修改后
pub(crate) const SCHEMA_VERSION: i32 = 11;
```

- [ ] **Step 3: 在 `apply_schema_migrations_on_conn` 中添加 v10→v11 分支**

在 `src-tauri/src/database/schema.rs` 的 `apply_schema_migrations_on_conn` 函数里，`9 =>` 分支之后、`_ =>` 之前添加：

```rust
                    10 => {
                        log::info!("迁移数据库从 v10 到 v11（添加技能分组功能）");
                        Self::migrate_v10_to_v11(conn)?;
                        Self::set_user_version(conn, 11)?;
                    }
```

- [ ] **Step 4: 实现 `migrate_v10_to_v11` 函数**

在 `schema.rs` 同文件末尾添加：

```rust
    fn migrate_v10_to_v11(conn: &Connection) -> Result<(), AppError> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS skill_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                icon TEXT,
                is_active BOOLEAN NOT NULL DEFAULT 0,
                sort_index INTEGER,
                created_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS skill_group_members (
                group_id TEXT NOT NULL,
                skill_id TEXT NOT NULL,
                PRIMARY KEY (group_id, skill_id),
                FOREIGN KEY (group_id) REFERENCES skill_groups(id) ON DELETE CASCADE,
                FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
            );",
        )
        .map_err(|e| AppError::Database(e.to_string()))
    }
```

- [ ] **Step 5: 编译验证**

```bash
cd src-tauri && cargo check 2>&1 | tail -20
```

期望：无 error。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/database/schema.rs src-tauri/src/database/mod.rs
git commit -m "feat(db): add skill_groups and skill_group_members tables (schema v11)"
```

---

## Task 2: DAO 层 — skill_groups CRUD

**Files:**
- Create: `src-tauri/src/database/dao/skill_groups.rs`
- Modify: `src-tauri/src/database/dao/mod.rs`

- [ ] **Step 1: 创建 `skill_groups.rs`，实现完整 CRUD**

```rust
//! skill_groups DAO

use crate::database::{lock_conn, Database};
use crate::error::AppError;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillGroup {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub is_active: bool,
    pub sort_index: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Database {
    pub fn get_all_skill_groups(&self) -> Result<Vec<SkillGroup>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, name, description, icon, is_active, sort_index, created_at, updated_at
                 FROM skill_groups ORDER BY COALESCE(sort_index, 9999), name ASC",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(SkillGroup {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    icon: row.get(3)?,
                    is_active: row.get(4)?,
                    sort_index: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })
            .map_err(|e| AppError::Database(e.to_string()))?;
        rows.map(|r| r.map_err(|e| AppError::Database(e.to_string())))
            .collect()
    }

    pub fn get_skill_group(&self, id: &str) -> Result<Option<SkillGroup>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, name, description, icon, is_active, sort_index, created_at, updated_at
                 FROM skill_groups WHERE id = ?1",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        match stmt.query_row([id], |row| {
            Ok(SkillGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                icon: row.get(3)?,
                is_active: row.get(4)?,
                sort_index: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        }) {
            Ok(g) => Ok(Some(g)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn create_skill_group(&self, group: &SkillGroup) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT INTO skill_groups (id, name, description, icon, is_active, sort_index, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                group.id, group.name, group.description, group.icon,
                group.is_active, group.sort_index, group.created_at, group.updated_at,
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn update_skill_group(&self, group: &SkillGroup) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "UPDATE skill_groups SET name=?2, description=?3, icon=?4, sort_index=?5, updated_at=?6
             WHERE id=?1",
            params![group.id, group.name, group.description, group.icon, group.sort_index, group.updated_at],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn delete_skill_group(&self, id: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute("DELETE FROM skill_groups WHERE id=?1", [id])
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

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

    pub fn add_skill_to_group(&self, group_id: &str, skill_id: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR IGNORE INTO skill_group_members (group_id, skill_id) VALUES (?1, ?2)",
            params![group_id, skill_id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn remove_skill_from_group(&self, group_id: &str, skill_id: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM skill_group_members WHERE group_id=?1 AND skill_id=?2",
            params![group_id, skill_id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn get_group_member_ids(&self, group_id: &str) -> Result<Vec<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT skill_id FROM skill_group_members WHERE group_id=?1")
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map([group_id], |row| row.get::<_, String>(0))
            .map_err(|e| AppError::Database(e.to_string()))?;
        rows.map(|r| r.map_err(|e| AppError::Database(e.to_string())))
            .collect()
    }

    /// 获取每个 skill_id 所属的所有 group name（用于前端 badge 展示）
    pub fn get_skill_group_names(&self, skill_id: &str) -> Result<Vec<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT sg.name FROM skill_groups sg
                 JOIN skill_group_members sgm ON sg.id = sgm.group_id
                 WHERE sgm.skill_id = ?1 ORDER BY sg.name ASC",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map([skill_id], |row| row.get::<_, String>(0))
            .map_err(|e| AppError::Database(e.to_string()))?;
        rows.map(|r| r.map_err(|e| AppError::Database(e.to_string())))
            .collect()
    }
}
```

- [ ] **Step 2: 在 `dao/mod.rs` 中注册模块**

```rust
// 在现有 pub mod 列表中添加
pub mod skill_groups;
```

- [ ] **Step 3: 编译验证**

```bash
cd src-tauri && cargo check 2>&1 | tail -20
```

期望：无 error。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/database/dao/skill_groups.rs src-tauri/src/database/dao/mod.rs
git commit -m "feat(dao): add skill_groups DAO with CRUD and membership queries"
```

---

## Task 3: 服务层 — 激活/停用技能分组

**Files:**
- Create: `src-tauri/src/services/skill_group.rs`
- Modify: `src-tauri/src/services/mod.rs`

- [ ] **Step 1: 创建 `skill_group.rs` 服务**

```rust
//! SkillGroup 业务逻辑层

use crate::database::dao::skill_groups::SkillGroup;
use crate::database::Database;
use crate::error::AppError;
use crate::services::skill::SkillService;
use chrono::Utc;
use uuid::Uuid;

pub struct SkillGroupService;

impl SkillGroupService {
    /// 创建新分组
    pub fn create(
        db: &Database,
        name: String,
        description: Option<String>,
        icon: Option<String>,
    ) -> Result<SkillGroup, AppError> {
        let now = Utc::now().timestamp();
        let group = SkillGroup {
            id: Uuid::new_v4().to_string(),
            name,
            description,
            icon,
            is_active: false,
            sort_index: None,
            created_at: now,
            updated_at: now,
        };
        db.create_skill_group(&group)?;
        Ok(group)
    }

    /// 更新分组元信息（名称/描述/图标）
    pub fn update(
        db: &Database,
        id: &str,
        name: String,
        description: Option<String>,
        icon: Option<String>,
    ) -> Result<SkillGroup, AppError> {
        let mut group = db
            .get_skill_group(id)?
            .ok_or_else(|| AppError::NotFound(format!("分组不存在: {id}")))?;
        group.name = name;
        group.description = description;
        group.icon = icon;
        group.updated_at = Utc::now().timestamp();
        db.update_skill_group(&group)?;
        Ok(group)
    }

    /// 激活一个分组（独占模式）：先禁用所有 skill 的文件系统同步，再同步本组成员
    pub fn activate(db: &Database, group_id: &str) -> Result<(), AppError> {
        // 1. 验证分组存在
        db.get_skill_group(group_id)?
            .ok_or_else(|| AppError::NotFound(format!("分组不存在: {group_id}")))?;

        // 2. 获取本组成员 skill_ids
        let member_ids = db.get_group_member_ids(group_id)?;

        // 3. 禁用所有 skill（文件系统 + 数据库 enabled_* 全置 false）
        SkillService::disable_all_skills(db)?;

        // 4. 按本组成员的原有 per-app 开关重新启用（恢复 apps 状态并同步文件系统）
        SkillService::enable_skills_by_ids(db, &member_ids)?;

        // 5. 更新 is_active 标记
        db.set_skill_group_active(group_id, true)?;

        Ok(())
    }

    /// 停用所有分组：禁用所有 skill 的文件系统同步
    pub fn deactivate_all(db: &Database) -> Result<(), AppError> {
        SkillService::disable_all_skills(db)?;
        db.set_skill_group_active("", false)?; // 空 id + false = 全部置 0
        Ok(())
    }
}
```

- [ ] **Step 2: 在 `SkillService` 中添加两个辅助方法**

打开 `src-tauri/src/services/skill.rs`，在 `impl SkillService` 末尾添加：

```rust
    /// 将所有已安装 skill 从各 app 目录移除（文件系统），数据库 enabled_* 保持不变
    pub fn disable_all_skills(db: &Database) -> Result<(), AppError> {
        let skills = Self::get_all_installed(db)?;
        for skill in &skills {
            // 对每个 skill 逐 app 移除 symlink/copy
            for app in skill.apps.enabled_apps() {
                if let Err(e) = Self::remove_skill_from_app_dir(db, &skill.id, &app) {
                    log::warn!("disable_all: 移除 skill {} from {:?} 失败: {e}", skill.id, app);
                }
            }
        }
        Ok(())
    }

    /// 按 skill_ids 列表，将对应 skill 按其 per-app 开关重新同步到文件系统
    pub fn enable_skills_by_ids(db: &Database, ids: &[String]) -> Result<(), AppError> {
        for id in ids {
            match db.get_installed_skill(id)? {
                Some(skill) => {
                    for app in skill.apps.enabled_apps() {
                        if let Err(e) = Self::sync_skill_to_app(db, &skill.id, &app) {
                            log::warn!("enable_skills_by_ids: 同步 skill {} to {:?} 失败: {e}", skill.id, app);
                        }
                    }
                }
                None => log::warn!("enable_skills_by_ids: skill {id} 不存在，跳过"),
            }
        }
        Ok(())
    }
```

> **注意**：`remove_skill_from_app_dir` 和 `sync_skill_to_app` 是对现有 `SkillService` 内部方法的封装调用，需检查现有代码中对应的私有函数名，并在此处改为匹配的实际函数调用。如果现有服务已有 `sync_skill` 或 `unlink_skill` 等方法，直接复用。

- [ ] **Step 3: 检查 SkillService 现有文件系统操作方法**

```bash
grep -n "fn.*skill\|fn.*sync\|fn.*remove\|fn.*unlink\|fn.*copy" src-tauri/src/services/skill.rs | head -30
```

根据输出调整 Step 2 中的函数名使其与实际一致。

- [ ] **Step 4: 在 `services/mod.rs` 中导出新服务**

```bash
grep -n "pub mod\|pub use" src-tauri/src/services/mod.rs | head -20
```

然后添加：

```rust
pub mod skill_group;
pub use skill_group::SkillGroupService;
```

- [ ] **Step 5: 编译验证**

```bash
cd src-tauri && cargo check 2>&1 | tail -30
```

期望：无 error（如有 unresolved method 错误，根据实际方法名修正 Step 2）。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/services/skill_group.rs src-tauri/src/services/skill.rs src-tauri/src/services/mod.rs
git commit -m "feat(service): add SkillGroupService with activate/deactivate logic"
```

---

## Task 4: Tauri 命令层

**Files:**
- Create: `src-tauri/src/commands/skill_group.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 创建 `commands/skill_group.rs`**

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
    icon: Option<String>,
    app_state: State<'_, AppState>,
) -> Result<SkillGroup, String> {
    SkillGroupService::create(&app_state.db, name, description, icon).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_skill_group(
    id: String,
    name: String,
    description: Option<String>,
    icon: Option<String>,
    app_state: State<'_, AppState>,
) -> Result<SkillGroup, String> {
    SkillGroupService::update(&app_state.db, &id, name, description, icon)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_skill_group(id: String, app_state: State<'_, AppState>) -> Result<(), String> {
    app_state.db.delete_skill_group(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn activate_skill_group(id: String, app_state: State<'_, AppState>) -> Result<(), String> {
    SkillGroupService::activate(&app_state.db, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn deactivate_all_skill_groups(app_state: State<'_, AppState>) -> Result<(), String> {
    SkillGroupService::deactivate_all(&app_state.db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_skill_to_group(
    group_id: String,
    skill_id: String,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    app_state
        .db
        .add_skill_to_group(&group_id, &skill_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_skill_from_group(
    group_id: String,
    skill_id: String,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    app_state
        .db
        .remove_skill_from_group(&group_id, &skill_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_group_member_ids(
    group_id: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    app_state
        .db
        .get_group_member_ids(&group_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_skill_group_names(
    skill_id: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    app_state
        .db
        .get_skill_group_names(&skill_id)
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: 在 `commands/mod.rs` 注册新模块**

在现有 `mod` 列表中（按字母顺序）添加：

```rust
pub mod skill_group;
pub use skill_group::*;
```

- [ ] **Step 3: 在 `lib.rs` 的 `invoke_handler` 中注册所有新命令**

在 `// Skill management (v3.10.0+ unified)` 注释块附近添加：

```rust
            // Skill group management
            commands::get_skill_groups,
            commands::create_skill_group,
            commands::update_skill_group,
            commands::delete_skill_group,
            commands::activate_skill_group,
            commands::deactivate_all_skill_groups,
            commands::add_skill_to_group,
            commands::remove_skill_from_group,
            commands::get_group_member_ids,
            commands::get_skill_group_names,
```

- [ ] **Step 4: 编译验证**

```bash
cd src-tauri && cargo check 2>&1 | tail -20
```

期望：无 error。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/commands/skill_group.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(commands): add skill group Tauri commands"
```

---

## Task 5: 前端 API 层 + React Query hooks

**Files:**
- Modify: `src/lib/api/skills.ts`
- Create: `src/lib/api/skillGroups.ts`
- Create: `src/hooks/useSkillGroups.ts`

- [ ] **Step 1: 在 `src/lib/api/skills.ts` 末尾添加 SkillGroup 类型**

```typescript
/** 技能分组 */
export interface SkillGroup {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  isActive: boolean;
  sortIndex?: number;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 2: 创建 `src/lib/api/skillGroups.ts`**

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { SkillGroup } from "@/lib/api/skills";

export const skillGroupsApi = {
  getAll: (): Promise<SkillGroup[]> => invoke("get_skill_groups"),

  create: (params: {
    name: string;
    description?: string;
    icon?: string;
  }): Promise<SkillGroup> =>
    invoke("create_skill_group", {
      name: params.name,
      description: params.description ?? null,
      icon: params.icon ?? null,
    }),

  update: (params: {
    id: string;
    name: string;
    description?: string;
    icon?: string;
  }): Promise<SkillGroup> =>
    invoke("update_skill_group", {
      id: params.id,
      name: params.name,
      description: params.description ?? null,
      icon: params.icon ?? null,
    }),

  delete: (id: string): Promise<void> => invoke("delete_skill_group", { id }),

  activate: (id: string): Promise<void> =>
    invoke("activate_skill_group", { id }),

  deactivateAll: (): Promise<void> => invoke("deactivate_all_skill_groups"),

  addSkill: (groupId: string, skillId: string): Promise<void> =>
    invoke("add_skill_to_group", { groupId, skillId }),

  removeSkill: (groupId: string, skillId: string): Promise<void> =>
    invoke("remove_skill_from_group", { groupId, skillId }),

  getMemberIds: (groupId: string): Promise<string[]> =>
    invoke("get_group_member_ids", { groupId }),

  getSkillGroupNames: (skillId: string): Promise<string[]> =>
    invoke("get_skill_group_names", { skillId }),
};
```

- [ ] **Step 3: 创建 `src/hooks/useSkillGroups.ts`**

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { skillGroupsApi } from "@/lib/api/skillGroups";
import type { SkillGroup } from "@/lib/api/skills";

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
  });
}

export function useSkillGroupNames(skillId: string) {
  return useQuery({
    queryKey: ["skillGroups", "names", skillId],
    queryFn: () => skillGroupsApi.getSkillGroupNames(skillId),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skillGroups"] }),
  });
}

export function useDeleteSkillGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => skillGroupsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skillGroups"] }),
  });
}

export function useActivateSkillGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => skillGroupsApi.activate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skillGroups"] });
      qc.invalidateQueries({ queryKey: ["skills", "installed"] });
    },
  });
}

export function useDeactivateAllSkillGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => skillGroupsApi.deactivateAll(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skillGroups"] });
      qc.invalidateQueries({ queryKey: ["skills", "installed"] });
    },
  });
}

export function useAddSkillToGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, skillId }: { groupId: string; skillId: string }) =>
      skillGroupsApi.addSkill(groupId, skillId),
    onSuccess: (_data, { groupId }) => {
      qc.invalidateQueries({ queryKey: ["skillGroups", "members", groupId] });
      qc.invalidateQueries({ queryKey: ["skillGroups", "names"] });
    },
  });
}

export function useRemoveSkillFromGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, skillId }: { groupId: string; skillId: string }) =>
      skillGroupsApi.removeSkill(groupId, skillId),
    onSuccess: (_data, { groupId }) => {
      qc.invalidateQueries({ queryKey: ["skillGroups", "members", groupId] });
      qc.invalidateQueries({ queryKey: ["skillGroups", "names"] });
    },
  });
}
```

- [ ] **Step 4: 提交**

```bash
git add src/lib/api/skills.ts src/lib/api/skillGroups.ts src/hooks/useSkillGroups.ts
git commit -m "feat(frontend): add skill groups API layer and React Query hooks"
```

---

## Task 6: 分组编辑弹窗组件

**Files:**
- Create: `src/components/skills/SkillGroupEditDialog.tsx`

- [ ] **Step 1: 创建弹窗组件**

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
import { Badge } from "@/components/ui/badge";
import { Loader2, Search } from "lucide-react";
import { useInstalledSkills } from "@/hooks/useSkills";
import {
  useGroupMemberIds,
  useAddSkillToGroup,
  useRemoveSkillFromGroup,
} from "@/hooks/useSkillGroups";
import type { SkillGroup } from "@/lib/api/skills";

interface Props {
  open: boolean;
  group: SkillGroup | null; // null = 新建模式
  onClose: () => void;
  onSave: (params: { name: string; description?: string; icon?: string }) => void;
  saving?: boolean;
}

export function SkillGroupEditDialog({ open, group, onClose, onSave, saving }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) {
      setName(group?.name ?? "");
      setDescription(group?.description ?? "");
      setIcon(group?.icon ?? "");
      setSearch("");
    }
  }, [open, group]);

  const { data: installedSkills = [] } = useInstalledSkills();
  const { data: memberIds = [] } = useGroupMemberIds(group?.id ?? null);
  const addMutation = useAddSkillToGroup();
  const removeMutation = useRemoveSkillFromGroup();

  const filtered = installedSkills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.description ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const toggleMember = (skillId: string, checked: boolean) => {
    if (!group) return;
    if (checked) {
      addMutation.mutate({ groupId: group.id, skillId });
    } else {
      removeMutation.mutate({ groupId: group.id, skillId });
    }
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      icon: icon.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {group ? t("skillGroups.edit", "编辑分组") : t("skillGroups.create", "新建分组")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="图标 emoji，如 ✍️"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              className="w-24"
            />
            <Input
              placeholder={t("skillGroups.namePlaceholder", "分组名称")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1"
            />
          </div>
          <Textarea
            placeholder={t("skillGroups.descriptionPlaceholder", "描述（可选）")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>

        {group && (
          <div className="mt-4 space-y-2">
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
            <div className="max-h-52 overflow-y-auto space-y-1 border rounded-md p-2">
              {filtered.length === 0 ? (
                <div className="text-sm text-muted-foreground py-2 text-center">
                  {t("skillGroups.noSkills", "没有已安装的 Skill")}
                </div>
              ) : (
                filtered.map((skill) => {
                  const checked = memberIds.includes(skill.id);
                  const apps = Object.entries(skill.apps)
                    .filter(([, v]) => v)
                    .map(([k]) => k);
                  return (
                    <label
                      key={skill.id}
                      className="flex items-start gap-2 cursor-pointer rounded px-1 py-1 hover:bg-accent"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => toggleMember(skill.id, !!v)}
                        disabled={addMutation.isPending || removeMutation.isPending}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{skill.name}</div>
                        {skill.description && (
                          <div className="text-xs text-muted-foreground truncate">
                            {skill.description}
                          </div>
                        )}
                        <div className="flex gap-1 mt-0.5 flex-wrap">
                          {apps.map((app) => (
                            <Badge key={app} variant="secondary" className="text-[10px] py-0 px-1">
                              {app}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        )}

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

- [ ] **Step 2: 提交**

```bash
git add src/components/skills/SkillGroupEditDialog.tsx
git commit -m "feat(ui): add SkillGroupEditDialog component"
```

---

## Task 7: 分组列表面板组件

**Files:**
- Create: `src/components/skills/SkillGroupsPanel.tsx`

- [ ] **Step 1: 创建面板组件**

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit2, Trash2, Play, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SkillGroupEditDialog } from "./SkillGroupEditDialog";
import {
  useSkillGroups,
  useCreateSkillGroup,
  useUpdateSkillGroup,
  useDeleteSkillGroup,
  useActivateSkillGroup,
  useDeactivateAllSkillGroups,
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
  const activateMutation = useActivateSkillGroup();
  const deactivateMutation = useDeactivateAllSkillGroups();

  const handleSave = async (params: { name: string; description?: string; icon?: string }) => {
    const { group } = editDialogState;
    if (group) {
      await updateMutation.mutateAsync({ id: group.id, ...params });
      toast.success(t("skillGroups.updated", "分组已更新"));
    } else {
      await createMutation.mutateAsync(params);
      toast.success(t("skillGroups.created", "分组已创建"));
    }
    setEditDialogState({ open: false, group: null });
  };

  const handleDelete = async () => {
    if (!confirmDelete.group) return;
    await deleteMutation.mutateAsync(confirmDelete.group.id);
    toast.success(t("skillGroups.deleted", "分组已删除"));
    setConfirmDelete({ open: false, group: null });
  };

  const handleActivate = async (group: SkillGroup) => {
    if (group.isActive) {
      await deactivateMutation.mutateAsync();
      toast.success(t("skillGroups.deactivated", "已停用分组"));
    } else {
      await activateMutation.mutateAsync(group.id);
      toast.success(t("skillGroups.activated", `已激活：${group.name}`));
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
              className={`flex items-start gap-3 rounded-lg border p-3 ${
                group.isActive ? "border-primary bg-primary/5" : ""
              }`}
            >
              <div className="text-2xl leading-none mt-0.5">{group.icon ?? "📁"}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{group.name}</span>
                  {group.isActive && (
                    <Badge variant="default" className="text-[10px] py-0 px-1.5">
                      {t("skillGroups.active", "激活中")}
                    </Badge>
                  )}
                </div>
                {group.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {group.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant={group.isActive ? "secondary" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => handleActivate(group)}
                  disabled={activateMutation.isPending || deactivateMutation.isPending}
                >
                  {group.isActive ? (
                    <><Square className="h-3 w-3 mr-1" />{t("skillGroups.deactivate", "停用")}</>
                  ) : (
                    <><Play className="h-3 w-3 mr-1" />{t("skillGroups.activate", "激活")}</>
                  )}
                </Button>
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
          `确认删除「${confirmDelete.group?.name}」？分组内的 Skill 不会被卸载。`
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

- [ ] **Step 2: 提交**

```bash
git add src/components/skills/SkillGroupsPanel.tsx
git commit -m "feat(ui): add SkillGroupsPanel component"
```

---

## Task 8: 集成到 UnifiedSkillsPanel（标签页 + 激活提示条）

**Files:**
- Modify: `src/components/skills/UnifiedSkillsPanel.tsx`

- [ ] **Step 1: 查看现有 UnifiedSkillsPanel 的顶部区域**

```bash
head -120 src/components/skills/UnifiedSkillsPanel.tsx
```

- [ ] **Step 2: 添加标签页和激活提示条**

在 UnifiedSkillsPanel 中，找到已安装列表的渲染区域，在其外层包裹标签页结构。添加位置因现有代码结构而异，核心改动如下：

**a) 新增 import：**
```typescript
import { SkillGroupsPanel } from "./SkillGroupsPanel";
import { useSkillGroups, useDeactivateAllSkillGroups } from "@/hooks/useSkillGroups";
```

**b) 在组件内添加状态和查询：**
```typescript
const [activeTab, setActiveTab] = useState<"installed" | "groups">("installed");
const { data: groups = [] } = useSkillGroups();
const deactivateMutation = useDeactivateAllSkillGroups();
const activeGroup = groups.find((g) => g.isActive);
```

**c) 在 JSX 最顶层（已安装列表上方）添加标签页切换按钮：**
```tsx
{/* 标签页 */}
<div className="flex gap-1 mb-3">
  <Button
    variant={activeTab === "installed" ? "secondary" : "ghost"}
    size="sm"
    onClick={() => setActiveTab("installed")}
  >
    {t("skills.installed", "已安装")}
  </Button>
  <Button
    variant={activeTab === "groups" ? "secondary" : "ghost"}
    size="sm"
    onClick={() => setActiveTab("groups")}
  >
    {t("skillGroups.title", "分组")}
  </Button>
</div>

{/* 激活提示条 */}
{activeGroup && (
  <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md bg-primary/10 text-sm">
    <span>{activeGroup.icon ?? "📁"}</span>
    <span className="font-medium">
      {t("skillGroups.activeBanner", `当前激活：${activeGroup.name}`)}
    </span>
    <Button
      variant="link"
      size="sm"
      className="ml-auto h-auto p-0 text-sm"
      onClick={() => deactivateMutation.mutate()}
      disabled={deactivateMutation.isPending}
    >
      {t("skillGroups.deactivate", "停用")}
    </Button>
  </div>
)}
```

**d) 将已安装列表和 SkillGroupsPanel 按 `activeTab` 切换显示：**
```tsx
{activeTab === "installed" ? (
  /* 现有的已安装列表 JSX */
  <existing-installed-content />
) : (
  <SkillGroupsPanel />
)}
```

- [ ] **Step 3: TypeScript 类型检查**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

修复所有类型错误后继续。

- [ ] **Step 4: 提交**

```bash
git add src/components/skills/UnifiedSkillsPanel.tsx
git commit -m "feat(ui): integrate skill groups tab and active group banner into UnifiedSkillsPanel"
```

---

## Task 9: 端到端验证

- [ ] **Step 1: 启动开发服务**

```bash
pnpm tauri dev 2>&1 &
```

等待启动完成（约 30-60 秒）。

- [ ] **Step 2: 验证核心流程**

按以下顺序手动测试：

1. 进入 Skills → 确认看到"已安装"和"分组"两个标签页
2. 点击"分组"标签 → 看到空状态提示
3. 点击"新建分组" → 填写名称"写作模式"、图标"✍️" → 保存 → 确认列表显示该分组
4. 点击编辑 → 修改描述 → 保存 → 确认更新生效
5. 点击编辑 → 在 Skill 列表中勾选 1-2 个 skill → 关闭弹窗
6. 点击"激活" → 确认分组显示"激活中" badge、顶部出现提示条
7. 切换到"已安装"标签 → 确认提示条仍然可见
8. 点击提示条的"停用" → 确认激活状态消失
9. 再次激活 → 点击分组卡片上的"停用" → 确认状态消失
10. 点击删除 → 确认弹窗 → 确认分组消失

- [ ] **Step 3: 提交最终状态**

```bash
git add -A
git commit -m "feat: skill groups feature complete"
```

---

## 自审结果

**Spec 覆盖检查：**
- ✅ 两张新表（skill_groups / skill_group_members）→ Task 1
- ✅ 独占激活模式 → Task 3 SkillGroupService::activate
- ✅ 手动切换 UI → Task 7 SkillGroupsPanel
- ✅ 新建/编辑/删除分组 → Task 6 SkillGroupEditDialog + Task 7
- ✅ 一个 skill 可属于多个组 → Task 2 DAO 多对多设计
- ✅ 激活时沿用 skill 自身 per-app 开关 → Task 3 enable_skills_by_ids
- ✅ 已安装列表标签页 + 激活提示条 → Task 8
- ✅ CRUD 命令全覆盖 → Task 4

**已知注意事项：**
- Task 3 Step 2 中 `remove_skill_from_app_dir` / `sync_skill_to_app` 需在执行时对照实际 SkillService 方法名调整
- Task 8 需根据 UnifiedSkillsPanel 实际代码结构确定插入位置
