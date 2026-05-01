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
        if let Err(e) = WorkspaceSkillService::sync_workspaces_for_group(db, id) {
            log::warn!("update_skill_group: 工作空间同步失败: {e}");
        }
        group.member_ids = member_ids;
        Ok(group)
    }
}
