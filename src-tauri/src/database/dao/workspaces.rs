//! workspaces DAO

use crate::database::{lock_conn, Database};
use crate::error::AppError;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_user_level: bool,
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
            is_user_level: row.get::<_, i64>(3)? != 0,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
            group_ids: vec![],
        })
    }

    pub fn get_all_workspaces(&self) -> Result<Vec<Workspace>, AppError> {
        let conn = lock_conn!(self.conn);

        let mut workspaces: Vec<Workspace> = {
            let mut stmt = conn
                .prepare(
                    "SELECT id, name, path, is_user_level, created_at, updated_at
                     FROM workspaces
                     ORDER BY is_user_level DESC, name ASC",
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
            let result = stmt
                .query_map([], |row| Self::row_to_workspace(row))
                .map_err(|e| AppError::Database(e.to_string()))?
                .map(|r| r.map_err(|e| AppError::Database(e.to_string())))
                .collect::<Result<Vec<_>, _>>()?;
            result
        };

        let pairs: Vec<(String, String)> = {
            let mut stmt = conn
                .prepare(
                    "SELECT workspace_id, group_id FROM workspace_groups ORDER BY workspace_id",
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
            let result = stmt
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

    pub fn get_workspace(&self, id: &str) -> Result<Option<Workspace>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, name, path, is_user_level, created_at, updated_at
                 FROM workspaces WHERE id=?1",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        match stmt.query_row([id], |row| Self::row_to_workspace(row)) {
            Ok(ws) => Ok(Some(ws)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn create_workspace(&self, ws: &Workspace) -> Result<(), AppError> {
        if !ws.is_user_level && ws.path.trim() == "~" {
            return Err(AppError::InvalidInput(
                "路径不能为 ~（保留给用户级别空间）".to_string(),
            ));
        }
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT INTO workspaces
                (id, name, path, is_user_level, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                ws.id,
                ws.name,
                ws.path,
                ws.is_user_level as i64,
                ws.created_at,
                ws.updated_at
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn update_workspace(&self, ws: &Workspace) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        let is_user_level = conn
            .query_row(
                "SELECT is_user_level FROM workspaces WHERE id=?1",
                [&ws.id],
                |row| row.get::<_, bool>(0),
            )
            .optional()
            .map_err(|e| AppError::Database(e.to_string()))?
            .unwrap_or(false);
        if is_user_level {
            conn.execute(
                "UPDATE workspaces SET name=?1, updated_at=?2 WHERE id=?3",
                params![ws.name, ws.updated_at, ws.id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        } else {
            if ws.path.trim() == "~" {
                return Err(AppError::InvalidInput(
                    "路径不能为 ~（保留给用户级别空间）".to_string(),
                ));
            }
            conn.execute(
                "UPDATE workspaces SET name=?1, path=?2, updated_at=?3 WHERE id=?4",
                params![ws.name, ws.path, ws.updated_at, ws.id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        }
        Ok(())
    }

    pub fn delete_workspace(&self, id: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        let is_user_level = conn
            .query_row(
                "SELECT is_user_level FROM workspaces WHERE id=?1",
                [id],
                |row| row.get::<_, bool>(0),
            )
            .optional()
            .map_err(|e| AppError::Database(e.to_string()))?
            .unwrap_or(false);
        if is_user_level {
            return Err(AppError::InvalidInput("用户级别空间不可删除".to_string()));
        }
        conn.execute("DELETE FROM workspaces WHERE id=?1", [id])
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn get_workspace_skill_bindings(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT bindings.skill_id
                 FROM workspace_skill_bindings AS bindings
                 INNER JOIN workspaces AS workspace ON workspace.id=bindings.workspace_id
                 INNER JOIN skills AS skill ON skill.id=bindings.skill_id
                 WHERE bindings.workspace_id=?1
                 ORDER BY bindings.skill_id",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map([workspace_id], |row| row.get::<_, String>(0))
            .map_err(|e| AppError::Database(e.to_string()))?;
        rows.map(|r| r.map_err(|e| AppError::Database(e.to_string())))
            .collect()
    }

    pub fn toggle_workspace_skill(
        &self,
        workspace_id: &str,
        skill_id: &str,
        active: bool,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        if active {
            conn.execute(
                "INSERT OR IGNORE INTO workspace_skill_bindings (workspace_id, skill_id)
                 VALUES (?1, ?2)",
                params![workspace_id, skill_id],
            )
        } else {
            conn.execute(
                "DELETE FROM workspace_skill_bindings WHERE workspace_id=?1 AND skill_id=?2",
                params![workspace_id, skill_id],
            )
        }
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn get_user_level_workspace_skill_bindings(&self) -> Result<Vec<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT bindings.skill_id
                 FROM workspace_skill_bindings AS bindings
                 INNER JOIN workspaces AS workspace ON workspace.id=bindings.workspace_id
                 INNER JOIN skills AS skill ON skill.id=bindings.skill_id
                 WHERE workspace.is_user_level=1
                 ORDER BY bindings.skill_id",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| AppError::Database(e.to_string()))?;
        rows.map(|r| r.map_err(|e| AppError::Database(e.to_string())))
            .collect()
    }

    /// 查询直接绑定或通过激活分组间接包含指定 Skill 的工作空间。
    pub fn get_workspaces_containing_skill(&self, skill_id: &str) -> Result<Vec<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT workspace_id FROM (
                    SELECT bindings.workspace_id
                    FROM workspace_skill_bindings AS bindings
                    INNER JOIN workspaces AS workspace ON workspace.id=bindings.workspace_id
                    INNER JOIN skills AS skill ON skill.id=bindings.skill_id
                    WHERE bindings.skill_id=?1
                    UNION
                    SELECT active.workspace_id
                    FROM workspace_group_active AS active
                    INNER JOIN workspaces AS workspace ON workspace.id=active.workspace_id
                    INNER JOIN skill_group_members AS members
                        ON members.group_id=active.group_id
                    INNER JOIN skills AS skill ON skill.id=members.skill_id
                    WHERE members.skill_id=?1 AND workspace.is_user_level=0
                    UNION
                    SELECT workspace.id
                    FROM workspaces AS workspace
                    INNER JOIN skill_groups AS skill_group ON skill_group.is_active=1
                    INNER JOIN skill_group_members AS members
                        ON members.group_id=skill_group.id
                    INNER JOIN skills AS skill ON skill.id=members.skill_id
                    WHERE members.skill_id=?1 AND workspace.is_user_level=1
                 ) ORDER BY workspace_id",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map([skill_id], |row| row.get::<_, String>(0))
            .map_err(|e| AppError::Database(e.to_string()))?;
        rows.map(|r| r.map_err(|e| AppError::Database(e.to_string())))
            .collect()
    }

    pub fn add_group_to_workspace(
        &self,
        workspace_id: &str,
        group_id: &str,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR IGNORE INTO workspace_groups (workspace_id, group_id) VALUES (?1, ?2)",
            params![workspace_id, group_id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn remove_group_from_workspace(
        &self,
        workspace_id: &str,
        group_id: &str,
    ) -> Result<(), AppError> {
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

    pub fn toggle_workspace_group_active(
        &self,
        workspace_id: &str,
        group_id: &str,
        active: bool,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        let is_user_level: bool = conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM workspaces WHERE id=?1 AND is_user_level=1
                 )",
                [workspace_id],
                |row| row.get(0),
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        if is_user_level {
            let changed = conn
                .execute(
                    "UPDATE skill_groups SET is_active=?1 WHERE id=?2",
                    params![active, group_id],
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
            if changed == 0 {
                return Err(AppError::InvalidInput(format!(
                    "技能分组不存在: {group_id}"
                )));
            }
            return Ok(());
        }
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

    pub fn get_workspace_active_group_ids(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let is_user_level: bool = conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM workspaces WHERE id=?1 AND is_user_level=1
                 )",
                [workspace_id],
                |row| row.get(0),
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        let sql = if is_user_level {
            "SELECT id FROM skill_groups WHERE is_active=1 ORDER BY id"
        } else {
            "SELECT group_id FROM workspace_group_active
             WHERE workspace_id=?1 ORDER BY group_id"
        };
        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| AppError::Database(e.to_string()))?;
        let map_id: fn(&rusqlite::Row<'_>) -> rusqlite::Result<String> = |row| row.get(0);
        let rows = if is_user_level {
            stmt.query_map([], map_id)
        } else {
            stmt.query_map([workspace_id], map_id)
        }
        .map_err(|e| AppError::Database(e.to_string()))?;
        rows.map(|r| r.map_err(|e| AppError::Database(e.to_string())))
            .collect()
    }

    pub fn get_workspaces_with_active_group(
        &self,
        group_id: &str,
    ) -> Result<Vec<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT active.workspace_id
                 FROM workspace_group_active AS active
                 INNER JOIN workspaces AS workspace ON workspace.id=active.workspace_id
                 WHERE active.group_id=?1 AND workspace.is_user_level=0",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map([group_id], |row| row.get::<_, String>(0))
            .map_err(|e| AppError::Database(e.to_string()))?;
        rows.map(|r| r.map_err(|e| AppError::Database(e.to_string())))
            .collect()
    }
}
