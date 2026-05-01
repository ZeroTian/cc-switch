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

        let mut workspaces: Vec<Workspace> = {
            let mut stmt = conn
                .prepare("SELECT id, name, path, created_at, updated_at FROM workspaces ORDER BY name ASC")
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
                .prepare("SELECT workspace_id, group_id FROM workspace_groups ORDER BY workspace_id")
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
            .prepare("SELECT id, name, path, created_at, updated_at FROM workspaces WHERE id=?1")
            .map_err(|e| AppError::Database(e.to_string()))?;
        match stmt.query_row([id], |row| Self::row_to_workspace(row)) {
            Ok(ws) => Ok(Some(ws)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn create_workspace(&self, ws: &Workspace) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT INTO workspaces (id, name, path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
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
