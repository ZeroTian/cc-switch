# Workspaces 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 cc-switch 添加工作空间功能，用户可将项目目录与多个 Skill 分组绑定，点击"应用"后将分组成员 Skill 同步到该目录的 `.claude/skills/`。

**Architecture:** 后端新增 `workspaces` / `workspace_groups` 两张表（schema v13→v14），服务层实现 `apply_workspace` 将多个分组成员 Skill 的并集 symlink 到指定目录；前端在 Skills 管理页新增"工作空间"tab，包含列表面板和编辑弹窗。

**Tech Stack:** Rust（rusqlite、Tauri）、TypeScript（React、@tanstack/react-query）、shadcn/ui

---

## 文件变更清单

### 新增
- `src-tauri/src/database/dao/workspaces.rs` — Workspace CRUD + workspace_groups 关联查询
- `src-tauri/src/services/workspace_skill.rs` — apply_workspace 业务逻辑
- `src-tauri/src/commands/workspace_skill.rs` — Tauri 命令层
- `src/lib/api/workspaces.ts` — 前端 invoke 封装
- `src/hooks/useWorkspaces.ts` — React Query hooks
- `src/components/skills/WorkspacesPanel.tsx` — 工作空间列表面板
- `src/components/skills/WorkspaceEditDialog.tsx` — 新建/编辑弹窗

### 修改
- `src-tauri/src/database/schema.rs` — 新增两张表 + v13→v14 migration
- `src-tauri/src/database/mod.rs` — SCHEMA_VERSION = 14
- `src-tauri/src/database/dao/mod.rs` — 注册 pub mod workspaces
- `src-tauri/src/services/mod.rs` — 注册 pub mod workspace_skill
- `src-tauri/src/commands/mod.rs` — 注册 pub mod workspace_skill + pub use
- `src-tauri/src/lib.rs` — invoke_handler 添加新命令
- `src/components/skills/UnifiedSkillsPanel.tsx` — 新增"工作空间"tab

---

## Task 1: 数据库 schema — 新增两张表 + migration

**Files:**
- Modify: `src-tauri/src/database/schema.rs`
- Modify: `src-tauri/src/database/mod.rs`

- [ ] **Step 1: 将 SCHEMA_VERSION 从 13 改为 14**

`src-tauri/src/database/mod.rs` 第 47 行：
```rust
pub(crate) const SCHEMA_VERSION: i32 = 14;
```

- [ ] **Step 2: 在 `create_tables_on_conn` 末尾追加两张表**

在 `schema.rs` 的 `create_tables_on_conn` 函数中，在 `Ok(())` 之前追加：

```rust
        // 工作空间定义表
        conn.execute(
            "CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        // 工作空间与分组多对多关联表
        conn.execute(
            "CREATE TABLE IF NOT EXISTS workspace_groups (
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

- [ ] **Step 3: 在 `apply_schema_migrations_on_conn` 添加 v13→v14 分支**

在 `12 =>` 分支之后、`_ =>` 之前添加：

```rust
                    13 => {
                        log::info!("迁移数据库从 v13 到 v14（添加工作空间功能）");
                        Self::migrate_v13_to_v14(conn)?;
                        Self::set_user_version(conn, 14)?;
                    }
```

- [ ] **Step 4: 实现 `migrate_v13_to_v14` 函数**

在 `migrate_v12_to_v13` 函数之后追加：

```rust
    fn migrate_v13_to_v14(conn: &Connection) -> Result<(), AppError> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS workspace_groups (
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
git add src-tauri/src/database/schema.rs src-tauri/src/database/mod.rs
git commit -m "feat(db): add workspaces and workspace_groups tables (schema v14)"
```

---

## Task 2: DAO 层 — Workspace CRUD

**Files:**
- Create: `src-tauri/src/database/dao/workspaces.rs`
- Modify: `src-tauri/src/database/dao/mod.rs`

- [ ] **Step 1: 创建 `src-tauri/src/database/dao/workspaces.rs`**

```rust
//! workspaces DAO

use crate::database::{lock_conn, Database};
use crate::error::AppError;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub group_ids: Vec<String>,
}

impl Database {
    fn row_to_workspace(row: &rusqlite::Row<'_>) -> rusqlite::Result<Workspace> {
        Ok(Workspace {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
            group_ids: vec![],
        })
    }

    pub fn get_all_workspaces(&self) -> Result<Vec<Workspace>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, name, path, created_at, updated_at
                 FROM workspaces ORDER BY name ASC",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        let mut workspaces: Vec<Workspace> = {
            let rows = stmt
                .query_map([], |row| Self::row_to_workspace(row))
                .map_err(|e| AppError::Database(e.to_string()))?;
            rows.map(|r| r.map_err(|e| AppError::Database(e.to_string())))
                .collect::<Result<Vec<_>, _>>()?
        };

        // 批量填充 group_ids
        let pairs: Vec<(String, String)> = {
            let mut s = conn
                .prepare("SELECT workspace_id, group_id FROM workspace_groups ORDER BY workspace_id")
                .map_err(|e| AppError::Database(e.to_string()))?;
            let result = s
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|e| AppError::Database(e.to_string()))?
                .map(|r| r.map_err(|e| AppError::Database(e.to_string())))
                .collect::<Result<Vec<_>, _>>()?;
            result
        };
        for ws in &mut workspaces {
            ws.group_ids = pairs
                .iter()
                .filter(|(wid, _)| wid == &ws.id)
                .map(|(_, gid)| gid.clone())
                .collect();
        }
        Ok(workspaces)
    }

    pub fn create_workspace(&self, ws: &Workspace) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT INTO workspaces (id, name, path, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![ws.id, ws.name, ws.path, ws.created_at, ws.updated_at],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn update_workspace(&self, ws: &Workspace) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "UPDATE workspaces SET name=?1, path=?2, updated_at=?3 WHERE id=?4",
            params![ws.name, ws.path, ws.updated_at, ws.id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn delete_workspace(&self, id: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute("DELETE FROM workspaces WHERE id=?1", [id])
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn get_workspace(&self, id: &str) -> Result<Option<Workspace>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT id, name, path, created_at, updated_at FROM workspaces WHERE id=?1")
            .map_err(|e| AppError::Database(e.to_string()))?;
        match stmt.query_row([id], |row| Self::row_to_workspace(row)) {
            Ok(ws) => Ok(Some(ws)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn add_group_to_workspace(&self, workspace_id: &str, group_id: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR IGNORE INTO workspace_groups (workspace_id, group_id) VALUES (?1, ?2)",
            params![workspace_id, group_id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn remove_group_from_workspace(&self, workspace_id: &str, group_id: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM workspace_groups WHERE workspace_id=?1 AND group_id=?2",
            params![workspace_id, group_id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn get_workspace_group_ids(&self, workspace_id: &str) -> Result<Vec<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT group_id FROM workspace_groups WHERE workspace_id=?1")
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map([workspace_id], |row| row.get::<_, String>(0))
            .map_err(|e| AppError::Database(e.to_string()))?;
        rows.map(|r| r.map_err(|e| AppError::Database(e.to_string())))
            .collect()
    }
}
```

- [ ] **Step 2: 在 `dao/mod.rs` 注册模块**

```rust
pub mod workspaces;
```

- [ ] **Step 3: 提交**

```bash
git add src-tauri/src/database/dao/workspaces.rs src-tauri/src/database/dao/mod.rs
git commit -m "feat(dao): add workspaces DAO"
```

---

## Task 3: 服务层 — apply_workspace

**Files:**
- Create: `src-tauri/src/services/workspace_skill.rs`
- Modify: `src-tauri/src/services/mod.rs`

- [ ] **Step 1: 创建 `src-tauri/src/services/workspace_skill.rs`**

```rust
//! WorkspaceSkill 业务逻辑层

use crate::database::Database;
use crate::error::AppError;
use crate::services::skill::SkillService;
use anyhow::{anyhow, Result};
use std::collections::HashSet;
use std::sync::Arc;

pub struct ApplyResult {
    pub synced: usize,
    pub failed: Vec<String>,
}

pub struct WorkspaceSkillService;

impl WorkspaceSkillService {
    /// 将工作空间所有绑定分组的成员 Skill 同步到 <path>/.claude/skills/
    pub fn apply(db: &Arc<Database>, workspace_id: &str) -> Result<ApplyResult> {
        let ws = db
            .get_workspace(workspace_id)
            .map_err(|e| anyhow!("{e}"))?
            .ok_or_else(|| anyhow!("工作空间不存在: {workspace_id}"))?;

        let group_ids = db
            .get_workspace_group_ids(workspace_id)
            .map_err(|e| anyhow!("{e}"))?;

        // 收集所有分组成员 skill_id（去重）
        let mut skill_ids: HashSet<String> = HashSet::new();
        for group_id in &group_ids {
            let members = db
                .get_group_member_ids(group_id)
                .map_err(|e| anyhow!("{e}"))?;
            skill_ids.extend(members);
        }

        let target_skills_dir = std::path::Path::new(&ws.path).join(".claude").join("skills");
        std::fs::create_dir_all(&target_skills_dir)
            .map_err(|e| anyhow!("创建目录失败 {}: {e}", target_skills_dir.display()))?;

        let ssot_dir = SkillService::get_ssot_dir()?;

        let mut synced = 0usize;
        let mut failed: Vec<String> = Vec::new();

        for skill_id in &skill_ids {
            match db.get_installed_skill(skill_id) {
                Ok(Some(skill)) => {
                    let source = ssot_dir.join(&skill.directory);
                    if !source.exists() {
                        log::warn!("apply_workspace: SSOT skill {} 不存在，跳过", skill.name);
                        failed.push(skill.name.clone());
                        continue;
                    }
                    let dest = target_skills_dir.join(&skill.directory);
                    // 已存在则跳过
                    if dest.exists() {
                        synced += 1;
                        continue;
                    }
                    match Self::create_symlink(&source, &dest) {
                        Ok(()) => synced += 1,
                        Err(e) => {
                            log::warn!("apply_workspace: symlink skill {} 失败: {e}", skill.name);
                            // symlink 失败时回退到复制
                            match Self::copy_dir(&source, &dest) {
                                Ok(()) => synced += 1,
                                Err(e2) => {
                                    log::warn!("apply_workspace: 复制 skill {} 失败: {e2}", skill.name);
                                    failed.push(skill.name.clone());
                                }
                            }
                        }
                    }
                }
                Ok(None) => log::warn!("apply_workspace: skill {skill_id} 不存在，跳过"),
                Err(e) => log::warn!("apply_workspace: 读取 skill {skill_id} 失败: {e}"),
            }
        }

        Ok(ApplyResult { synced, failed })
    }

    fn create_symlink(source: &std::path::Path, dest: &std::path::Path) -> Result<()> {
        #[cfg(unix)]
        std::os::unix::fs::symlink(source, dest)?;
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(source, dest)?;
        Ok(())
    }

    fn copy_dir(source: &std::path::Path, dest: &std::path::Path) -> Result<()> {
        std::fs::create_dir_all(dest)?;
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            let dest_path = dest.join(entry.file_name());
            if entry.file_type()?.is_dir() {
                Self::copy_dir(&entry.path(), &dest_path)?;
            } else {
                std::fs::copy(entry.path(), dest_path)?;
            }
        }
        Ok(())
    }
}
```

- [ ] **Step 2: 在 `services/mod.rs` 注册**

```rust
pub mod workspace_skill;
pub use workspace_skill::WorkspaceSkillService;
```

- [ ] **Step 3: 提交**

```bash
git add src-tauri/src/services/workspace_skill.rs src-tauri/src/services/mod.rs
git commit -m "feat(service): add WorkspaceSkillService with apply logic"
```

---

## Task 4: Tauri 命令层

**Files:**
- Create: `src-tauri/src/commands/workspace_skill.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 创建 `src-tauri/src/commands/workspace_skill.rs`**

```rust
//! 工作空间命令层

use crate::database::dao::workspaces::Workspace;
use crate::services::workspace_skill::WorkspaceSkillService;
use crate::store::AppState;
use chrono::Utc;
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub synced: usize,
    pub failed: Vec<String>,
}

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
    let now = Utc::now().timestamp();
    let ws = Workspace {
        id: Uuid::new_v4().to_string(),
        name,
        path,
        created_at: now,
        updated_at: now,
        group_ids: vec![],
    };
    app_state.db.create_workspace(&ws).map_err(|e| e.to_string())?;
    Ok(ws)
}

#[tauri::command]
pub fn update_workspace(
    id: String,
    name: String,
    path: String,
    app_state: State<'_, AppState>,
) -> Result<Workspace, String> {
    let mut ws = app_state
        .db
        .get_workspace(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("工作空间不存在: {id}"))?;
    ws.name = name;
    ws.path = path;
    ws.updated_at = Utc::now().timestamp();
    app_state.db.update_workspace(&ws).map_err(|e| e.to_string())?;
    Ok(ws)
}

#[tauri::command]
pub fn delete_workspace(id: String, app_state: State<'_, AppState>) -> Result<(), String> {
    app_state.db.delete_workspace(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_group_to_workspace(
    workspace_id: String,
    group_id: String,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    app_state
        .db
        .add_group_to_workspace(&workspace_id, &group_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_group_from_workspace(
    workspace_id: String,
    group_id: String,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    app_state
        .db
        .remove_group_from_workspace(&workspace_id, &group_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_workspace_group_ids(
    workspace_id: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    app_state
        .db
        .get_workspace_group_ids(&workspace_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn apply_workspace(
    workspace_id: String,
    app_state: State<'_, AppState>,
) -> Result<ApplyResult, String> {
    WorkspaceSkillService::apply(&app_state.db, &workspace_id)
        .map(|r| ApplyResult { synced: r.synced, failed: r.failed })
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: 在 `commands/mod.rs` 注册**

```rust
pub mod workspace_skill;
pub use workspace_skill::*;
```

- [ ] **Step 3: 在 `lib.rs` invoke_handler 中注册命令**

在 `// Skill group management` 注释块附近添加：

```rust
            // Workspace skill management
            commands::get_workspaces,
            commands::create_workspace,
            commands::update_workspace,
            commands::delete_workspace,
            commands::add_group_to_workspace,
            commands::remove_group_from_workspace,
            commands::get_workspace_group_ids,
            commands::apply_workspace,
```

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/commands/workspace_skill.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(commands): add workspace skill Tauri commands"
```

---

## Task 5: 前端 API + Hooks

**Files:**
- Create: `src/lib/api/workspaces.ts`
- Create: `src/hooks/useWorkspaces.ts`

- [ ] **Step 1: 创建 `src/lib/api/workspaces.ts`**

```typescript
import { invoke } from "@tauri-apps/api/core";

export interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  groupIds: string[];
}

export interface ApplyResult {
  synced: number;
  failed: string[];
}

export const workspacesApi = {
  getAll: (): Promise<Workspace[]> => invoke("get_workspaces"),

  create: (params: { name: string; path: string }): Promise<Workspace> =>
    invoke("create_workspace", { name: params.name, path: params.path }),

  update: (params: { id: string; name: string; path: string }): Promise<Workspace> =>
    invoke("update_workspace", { id: params.id, name: params.name, path: params.path }),

  delete: (id: string): Promise<void> => invoke("delete_workspace", { id }),

  addGroup: (workspaceId: string, groupId: string): Promise<void> =>
    invoke("add_group_to_workspace", { workspaceId, groupId }),

  removeGroup: (workspaceId: string, groupId: string): Promise<void> =>
    invoke("remove_group_from_workspace", { workspaceId, groupId }),

  getGroupIds: (workspaceId: string): Promise<string[]> =>
    invoke("get_workspace_group_ids", { workspaceId }),

  apply: (workspaceId: string): Promise<ApplyResult> =>
    invoke("apply_workspace", { workspaceId }),
};
```

- [ ] **Step 2: 创建 `src/hooks/useWorkspaces.ts`**

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

export function useAddGroupToWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, groupId }: { workspaceId: string; groupId: string }) =>
      workspacesApi.addGroup(workspaceId, groupId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

export function useRemoveGroupFromWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, groupId }: { workspaceId: string; groupId: string }) =>
      workspacesApi.removeGroup(workspaceId, groupId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

export function useApplyWorkspace() {
  return useMutation({
    mutationFn: (workspaceId: string) => workspacesApi.apply(workspaceId),
  });
}
```

- [ ] **Step 3: 提交**

```bash
git add src/lib/api/workspaces.ts src/hooks/useWorkspaces.ts
git commit -m "feat(frontend): add workspaces API and hooks"
```

---

## Task 6: WorkspaceEditDialog 组件

**Files:**
- Create: `src/components/skills/WorkspaceEditDialog.tsx`

- [ ] **Step 1: 创建组件**

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
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, FolderOpen, Search } from "lucide-react";
import { settingsApi } from "@/lib/api";
import { useSkillGroups } from "@/hooks/useSkillGroups";
import {
  useAddGroupToWorkspace,
  useRemoveGroupFromWorkspace,
} from "@/hooks/useWorkspaces";
import type { Workspace } from "@/lib/api/workspaces";

interface Props {
  open: boolean;
  workspace: Workspace | null;
  onClose: () => void;
  onSave: (params: { name: string; path: string }) => void;
  saving?: boolean;
}

export function WorkspaceEditDialog({ open, workspace, onClose, onSave, saving }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) {
      setName(workspace?.name ?? "");
      setPath(workspace?.path ?? "");
      setSearch("");
    }
  }, [open, workspace]);

  const { data: groups = [] } = useSkillGroups();
  const addMutation = useAddGroupToWorkspace();
  const removeMutation = useRemoveGroupFromWorkspace();

  const boundGroupIds = workspace?.groupIds ?? [];

  const filteredGroups = groups.filter((g) =>
    g.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleBrowse = async () => {
    try {
      const selected = await settingsApi.pickDirectory();
      if (selected) setPath(selected);
    } catch {
      // user cancelled
    }
  };

  const toggleGroup = (groupId: string, checked: boolean) => {
    if (!workspace) return;
    if (checked) {
      addMutation.mutate({ workspaceId: workspace.id, groupId });
    } else {
      removeMutation.mutate({ workspaceId: workspace.id, groupId });
    }
  };

  const handleSave = () => {
    if (!name.trim() || !path.trim()) return;
    onSave({ name: name.trim(), path: path.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" zIndex="top">
        <DialogHeader>
          <DialogTitle>
            {workspace
              ? t("workspaces.edit", "编辑工作空间")
              : t("workspaces.create", "新建工作空间")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 min-h-0">
          <Input
            placeholder={t("workspaces.namePlaceholder", "工作空间名称")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex gap-2">
            <Input
              placeholder={t("workspaces.pathPlaceholder", "项目目录路径")}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="flex-1"
            />
            <Button variant="outline" size="sm" onClick={handleBrowse} type="button">
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>

          {workspace && (
            <div className="space-y-2">
              <div className="text-sm font-medium">
                {t("workspaces.bindGroups", "绑定分组")}
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("workspaces.searchGroups", "搜索分组")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <div className="space-y-1 border rounded-md p-2 max-h-48 overflow-y-auto">
                {filteredGroups.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-2 text-center">
                    {t("workspaces.noGroups", "没有可用分组")}
                  </div>
                ) : (
                  filteredGroups.map((group) => {
                    const checked = boundGroupIds.includes(group.id);
                    return (
                      <label
                        key={group.id}
                        className="flex items-center gap-2 cursor-pointer rounded px-1 py-1 hover:bg-accent"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => toggleGroup(group.id, !!v)}
                          disabled={addMutation.isPending || removeMutation.isPending}
                        />
                        <span className="text-sm">{group.name}</span>
                        {group.description && (
                          <span className="text-xs text-muted-foreground truncate flex-1">
                            {group.description}
                          </span>
                        )}
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
          <Button
            onClick={handleSave}
            disabled={!name.trim() || !path.trim() || saving}
          >
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
git add src/components/skills/WorkspaceEditDialog.tsx
git commit -m "feat(ui): add WorkspaceEditDialog component"
```

---

## Task 7: WorkspacesPanel 组件

**Files:**
- Create: `src/components/skills/WorkspacesPanel.tsx`

- [ ] **Step 1: 创建组件**

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Plus, Edit2, Trash2, FolderCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { WorkspaceEditDialog } from "./WorkspaceEditDialog";
import {
  useWorkspaces,
  useCreateWorkspace,
  useUpdateWorkspace,
  useDeleteWorkspace,
  useApplyWorkspace,
} from "@/hooks/useWorkspaces";
import type { Workspace } from "@/lib/api/workspaces";

export function WorkspacesPanel() {
  const { t } = useTranslation();
  const { data: workspaces = [], isLoading } = useWorkspaces();

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
  const applyMutation = useApplyWorkspace();

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
      setConfirmDelete({ open: false, workspace: null });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    }
  };

  const handleApply = async (workspace: Workspace) => {
    try {
      const result = await applyMutation.mutateAsync(workspace.id);
      if (result.failed.length > 0) {
        toast.warning(
          t("workspaces.applyPartial", "部分同步完成"),
          {
            description: t(
              "workspaces.applyFailedList",
              "{{synced}} 个成功，失败：{{failed}}",
              { synced: result.synced, failed: result.failed.join("、") }
            ),
          }
        );
      } else {
        toast.success(
          t("workspaces.applySuccess", "已同步 {{count}} 个 Skill", { count: result.synced }),
          { description: workspace.path }
        );
      }
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
          {workspaces.map((ws) => (
            <div key={ws.id} className="flex items-center gap-4 rounded-lg border px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{ws.name}</div>
                <div className="text-xs text-muted-foreground truncate mt-0.5">{ws.path}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t("workspaces.groupCount", "{{count}} 个分组", { count: ws.groupIds.length })}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 text-xs px-3"
                  onClick={() => handleApply(ws)}
                  disabled={applyMutation.isPending}
                >
                  <FolderCheck className="h-3 w-3 mr-1" />
                  {t("workspaces.apply", "应用")}
                </Button>
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
          ))}
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

- [ ] **Step 2: 提交**

```bash
git add src/components/skills/WorkspacesPanel.tsx
git commit -m "feat(ui): add WorkspacesPanel component"
```

---

## Task 8: 集成到 UnifiedSkillsPanel

**Files:**
- Modify: `src/components/skills/UnifiedSkillsPanel.tsx`

- [ ] **Step 1: 查看现有 tab 切换代码位置**

```bash
grep -n "已安装\|分组\|tabInstalled\|skillGroups.title\|activeTab" src/components/skills/UnifiedSkillsPanel.tsx | head -10
```

- [ ] **Step 2: 新增 import**

在现有 import 区域添加：

```typescript
import { WorkspacesPanel } from "./WorkspacesPanel";
```

- [ ] **Step 3: 将 activeTab 类型扩展并新增第三个 tab 按钮**

修改 state 声明：

```typescript
const [activeTab, setActiveTab] = useState<"installed" | "groups" | "workspaces">("installed");
```

在"分组"tab 按钮之后添加"工作空间"按钮：

```tsx
<button
  type="button"
  onClick={() => setActiveTab("workspaces")}
  className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
    activeTab === "workspaces"
      ? "border-primary text-primary"
      : "border-transparent text-muted-foreground hover:text-foreground"
  }`}
>
  {t("workspaces.title", "工作空间")}
</button>
```

- [ ] **Step 4: 修改 tab 内容区的条件渲染**

将现有的：

```tsx
{activeTab === "installed" ? (
  ...
) : (
  <div className="flex-1 overflow-y-auto overflow-x-hidden pb-24">
    <SkillGroupsPanel />
  </div>
)}
```

改为三路：

```tsx
{activeTab === "installed" ? (
  ...
) : activeTab === "groups" ? (
  <div className="flex-1 overflow-y-auto overflow-x-hidden pb-24">
    <SkillGroupsPanel />
  </div>
) : (
  <div className="flex-1 overflow-y-auto overflow-x-hidden pb-24">
    <WorkspacesPanel />
  </div>
)}
```

- [ ] **Step 5: 确认 AppCountBar 和更新按钮只在 installed tab 显示**

确认现有的 `{activeTab === "installed" && <div ...>` 条件渲染仍然正确。

- [ ] **Step 6: TypeScript 检查**

```bash
pnpm exec tsc --noEmit 2>&1 | head -20
```

修复所有类型错误。

- [ ] **Step 7: 提交**

```bash
git add src/components/skills/UnifiedSkillsPanel.tsx
git commit -m "feat(ui): add workspaces tab to UnifiedSkillsPanel"
```

---

## Task 9: 确认 settingsApi.pickDirectory 可用

**Files:**
- Check: `src/lib/api/index.ts` 或 `src/lib/api/settings.ts`

- [ ] **Step 1: 确认 pickDirectory 的前端调用方式**

```bash
grep -rn "pickDirectory\|pick_directory" src/lib/api/ src/hooks/ | head -10
```

如果 `settingsApi.pickDirectory` 不存在，在 `src/lib/api/settings.ts`（或对应文件）中添加：

```typescript
pickDirectory: (): Promise<string | null> => invoke("pick_directory"),
```

- [ ] **Step 2: 提交（如有改动）**

```bash
git add src/lib/api/settings.ts
git commit -m "feat(api): expose pickDirectory in settingsApi"
```

---

## 自审结果

**Spec 覆盖检查：**
- ✅ workspaces + workspace_groups 两张表 → Task 1
- ✅ CRUD 命令全覆盖 → Task 4
- ✅ apply_workspace：取分组并集，symlink 到 `<path>/.claude/skills/` → Task 3
- ✅ 不影响全局配置 → Task 3（只写 target_skills_dir，不改数据库 enabled_*）
- ✅ 目录选择器（pick_directory） → Task 6 + Task 9
- ✅ 分组多选绑定 → Task 6
- ✅ 工作空间列表 + 应用/编辑/删除 → Task 7
- ✅ 第三个 tab 集成 → Task 8

**已知注意事项：**
- Task 9 需先确认 `settingsApi.pickDirectory` 是否已暴露，再决定是否需要添加
- Task 8 Step 4 需根据实际代码结构调整三路条件渲染的插入位置
