//! SkillGroup 业务逻辑层

use crate::database::dao::skill_groups::SkillGroup;
use crate::database::Database;
use crate::services::skill::SkillService;
use anyhow::{anyhow, Result};
use chrono::Utc;
use std::sync::Arc;
use uuid::Uuid;

pub struct SkillGroupService;

impl SkillGroupService {
    pub fn create(
        db: &Arc<Database>,
        name: String,
        description: Option<String>,
        icon: Option<String>,
    ) -> Result<SkillGroup> {
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

    pub fn update(
        db: &Arc<Database>,
        id: &str,
        name: String,
        description: Option<String>,
        icon: Option<String>,
    ) -> Result<SkillGroup> {
        let mut group = db
            .get_skill_group(id)?
            .ok_or_else(|| anyhow!("分组不存在: {id}"))?;
        group.name = name;
        group.description = description;
        group.icon = icon;
        group.updated_at = Utc::now().timestamp();
        db.update_skill_group(&group)?;
        Ok(group)
    }

    pub fn activate(db: &Arc<Database>, group_id: &str) -> Result<()> {
        db.get_skill_group(group_id)?
            .ok_or_else(|| anyhow!("分组不存在: {group_id}"))?;

        let member_ids = db.get_group_member_ids(group_id)?;

        SkillService::disable_all_skills(db)?;
        SkillService::enable_skills_by_ids(db, &member_ids)?;

        db.set_skill_group_active(group_id, true)?;
        Ok(())
    }

    pub fn deactivate_all(db: &Arc<Database>) -> Result<()> {
        SkillService::disable_all_skills(db)?;
        db.set_skill_group_active("", false)?;
        Ok(())
    }
}
