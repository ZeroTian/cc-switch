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
    pub is_user_level: bool,
    pub created_at: i64,
    pub updated_at: i64,
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
        })
    }

    pub fn get_all_workspaces(&self) -> Result<Vec<Workspace>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT id, name, path, is_user_level, created_at, updated_at FROM workspaces ORDER BY created_at ASC")
            .map_err(|e| AppError::Database(e.to_string()))?;
        let result = stmt
            .query_map([], |row| Self::row_to_workspace(row))
            .map_err(|e| AppError::Database(e.to_string()))?
            .map(|r| r.map_err(|e| AppError::Database(e.to_string())))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(result)
    }

    pub fn get_workspace(&self, id: &str) -> Result<Option<Workspace>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, name, path, is_user_level, created_at, updated_at
                 FROM workspaces WHERE id = ?1",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        match stmt.query_row([id], |row| Self::row_to_workspace(row)) {
            Ok(w) => Ok(Some(w)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn create_workspace(&self, ws: &Workspace) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT INTO workspaces (id, name, path, is_user_level, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![ws.id, ws.name, ws.path, ws.is_user_level as i64, ws.created_at, ws.updated_at],
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

    // workspace_skill_bindings

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

    // workspace_group_bindings

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
}
