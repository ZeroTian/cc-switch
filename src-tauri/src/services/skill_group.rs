//! SkillGroup 业务逻辑层

use crate::database::dao::skill_groups::{SkillGroup, SkillGroupApps};
use crate::database::Database;
use crate::services::workspace_skill::WorkspaceSkillService;
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
        WorkspaceSkillService::sync_global(db)?;
        WorkspaceSkillService::sync_workspaces_for_group(db, id)?;
        Ok(group)
    }

    /// 删除后成员及激活关系已被外键清理，使用删除前捕获的工作空间刷新目录。
    pub fn sync_after_delete(db: &Arc<Database>, workspace_ids: &[String]) -> Result<()> {
        WorkspaceSkillService::sync_global(db)?;
        for workspace_id in workspace_ids {
            WorkspaceSkillService::sync_active_groups_to_workspace(db, workspace_id)?;
        }
        Ok(())
    }

    /// 设置单个分组的全局激活状态，并重新同步全局 skills 目录
    pub fn set_active(db: &Arc<Database>, group_id: &str, active: bool) -> Result<()> {
        db.get_skill_group(group_id)?
            .ok_or_else(|| anyhow!("分组不存在: {group_id}"))?;
        db.set_skill_group_active(group_id, active)?;
        Self::sync_active_groups_to_global(db)
    }

    /// 复用工作空间服务的全局同步口径，避免分组切换擦除全局直绑 Skill。
    pub fn sync_active_groups_to_global(db: &Arc<Database>) -> Result<()> {
        WorkspaceSkillService::sync_global(db)
    }
}
