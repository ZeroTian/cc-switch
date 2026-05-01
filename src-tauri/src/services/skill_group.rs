//! SkillGroup 业务逻辑层

use crate::database::dao::skill_groups::{SkillGroup, SkillGroupApps};
use crate::database::Database;
use crate::services::skill::SkillService;
use anyhow::{anyhow, Result};
use chrono::Utc;
use std::collections::HashSet;
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
        Ok(group)
    }

    /// 设置单个分组的全局激活状态，并重新同步全局 skills 目录
    pub fn set_active(db: &Arc<Database>, group_id: &str, active: bool) -> Result<()> {
        db.get_skill_group(group_id)?
            .ok_or_else(|| anyhow!("分组不存在: {group_id}"))?;
        db.set_skill_group_active(group_id, active)?;
        Self::sync_active_groups_to_global(db)
    }

    /// 计算所有激活分组的成员 skill 并集，全量同步到全局 app 目录
    pub fn sync_active_groups_to_global(db: &Arc<Database>) -> Result<()> {
        let active_group_ids = db.get_active_skill_group_ids().map_err(|e| anyhow!("{e}"))?;

        let mut skill_ids: HashSet<String> = HashSet::new();
        for gid in &active_group_ids {
            let members = db.get_group_member_ids(gid).map_err(|e| anyhow!("{e}"))?;
            skill_ids.extend(members);
        }

        // 先禁用所有 skill（只操作文件系统，不改数据库 enabled_*）
        SkillService::disable_all_skills(db)?;

        // 按 skill 自身的 per-app 开关重新启用并集中的 skill
        for skill_id in &skill_ids {
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
}
