//! skill_groups DAO

use crate::database::{lock_conn, Database};
use crate::error::AppError;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillGroupApps {
    pub claude: bool,
    pub codex: bool,
    pub gemini: bool,
    pub opencode: bool,
    pub hermes: bool,
}

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
    pub apps: SkillGroupApps,
    /// 该分组的成员 skill_id 列表（仅在 get_all_skill_groups 时填充）
    #[serde(default)]
    pub member_ids: Vec<String>,
}

impl Database {
    fn row_to_group(row: &rusqlite::Row<'_>) -> rusqlite::Result<SkillGroup> {
        Ok(SkillGroup {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            icon: row.get(3)?,
            is_active: row.get(4)?,
            sort_index: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
            apps: SkillGroupApps {
                claude: row.get(8)?,
                codex: row.get(9)?,
                gemini: row.get(10)?,
                opencode: row.get(11)?,
                hermes: row.get(12)?,
            },
            member_ids: vec![],
        })
    }

    pub fn get_all_skill_groups(&self) -> Result<Vec<SkillGroup>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, name, description, icon, is_active, sort_index, created_at, updated_at,
                        enabled_claude, enabled_codex, enabled_gemini, enabled_opencode, enabled_hermes
                 FROM skill_groups ORDER BY COALESCE(sort_index, 9999), name ASC",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        let mut groups: Vec<SkillGroup> = stmt
            .query_map([], |row| Self::row_to_group(row))
            .map_err(|e| AppError::Database(e.to_string()))?
            .map(|r| r.map_err(|e| AppError::Database(e.to_string())))
            .collect::<Result<Vec<_>, _>>()?;

        // 批量填充成员 id（单次 JOIN 查询）
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
                "SELECT id, name, description, icon, is_active, sort_index, created_at, updated_at,
                        enabled_claude, enabled_codex, enabled_gemini, enabled_opencode, enabled_hermes
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
            "INSERT INTO skill_groups (id, name, description, icon, is_active, sort_index, created_at, updated_at,
                                       enabled_claude, enabled_codex, enabled_gemini, enabled_opencode, enabled_hermes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                group.id, group.name, group.description, group.icon,
                group.is_active, group.sort_index, group.created_at, group.updated_at,
                group.apps.claude, group.apps.codex, group.apps.gemini, group.apps.opencode, group.apps.hermes,
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn update_skill_group(&self, group: &SkillGroup) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "UPDATE skill_groups SET name=?1, description=?2, icon=?3, sort_index=?4, updated_at=?5,
                                     enabled_claude=?6, enabled_codex=?7, enabled_gemini=?8,
                                     enabled_opencode=?9, enabled_hermes=?10
             WHERE id=?11",
            params![
                group.name, group.description, group.icon, group.sort_index, group.updated_at,
                group.apps.claude, group.apps.codex, group.apps.gemini, group.apps.opencode, group.apps.hermes,
                group.id,
            ],
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
        let conn = lock_conn!(self.conn);
        conn.execute(
            "UPDATE skill_groups SET is_active = ?1 WHERE id = ?2",
            rusqlite::params![active, id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
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

}
