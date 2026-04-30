//! SkillGroup 业务逻辑层

use crate::app_config::AppType;
use crate::database::dao::skill_groups::{SkillGroup, SkillGroupApps};
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

    pub fn activate(db: &Arc<Database>, group_id: &str) -> Result<()> {
        let group = db
            .get_skill_group(group_id)?
            .ok_or_else(|| anyhow!("分组不存在: {group_id}"))?;

        let member_ids = db.get_group_member_ids(group_id)?;

        // 1. 保存当前所有 skill 的 enabled_* 快照（覆盖旧快照）
        db.save_skill_group_snapshot()?;

        // 2. 收集分组开启的 app 列表
        let mut enabled_apps: Vec<AppType> = Vec::new();
        if group.apps.claude { enabled_apps.push(AppType::Claude); }
        if group.apps.codex { enabled_apps.push(AppType::Codex); }
        if group.apps.gemini { enabled_apps.push(AppType::Gemini); }
        if group.apps.opencode { enabled_apps.push(AppType::OpenCode); }
        if group.apps.hermes { enabled_apps.push(AppType::Hermes); }

        // 3. 先禁用所有 skill（文件系统 + 数据库）
        SkillService::disable_all_skills_with_db(db)?;

        // 4. 按分组 app 开关启用组内 skill（文件系统 + 数据库）
        let sync_errors = SkillService::enable_skills_by_ids_for_apps_with_db(db, &member_ids, &enabled_apps)?;

        // 5. 更新 is_active（无论部分失败都标记激活）
        db.set_skill_group_active(group_id, true)?;

        if !sync_errors.is_empty() {
            return Err(anyhow!(
                "分组已激活，但以下 Skill 同步失败（可手动重新启用）：{}",
                sync_errors.join("、")
            ));
        }

        Ok(())
    }

    pub fn deactivate_all(db: &Arc<Database>) -> Result<()> {
        // 从快照恢复所有 skill 的 enabled_* 状态（同时更新数据库）
        let snapshot = db.restore_skill_group_snapshot()?;

        // 先清空所有文件系统链接
        SkillService::disable_all_skills(db)?;

        // 按恢复后的状态重新同步文件系统
        for (id, apps) in &snapshot {
            for app in apps.enabled_apps() {
                if let Ok(Some(skill)) = db.get_installed_skill(id) {
                    if let Err(e) = SkillService::sync_to_app_dir_pub(&skill.directory, &app) {
                        log::warn!("deactivate: 恢复 skill {} to {:?} 失败: {e}", skill.name, app);
                    }
                }
            }
        }

        db.clear_all_skill_group_active()?;
        Ok(())
    }
}
