//! 工作空间 Skill 同步服务

use crate::database::Database;
use crate::services::skill::SkillService;
use anyhow::{anyhow, Result};
use std::sync::Arc;

pub struct WorkspaceSkillService;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBindings {
    pub group_ids: Vec<String>,
    pub skill_ids: Vec<String>,
    pub total_skill_count: usize,
}

impl WorkspaceSkillService {
    /// 切换工作空间绑定分组，并触发同步
    pub fn toggle_group(db: &Arc<Database>, workspace_id: &str, group_id: &str, active: bool) -> Result<()> {
        db.toggle_workspace_group(workspace_id, group_id, active)
            .map_err(|e| anyhow!("{e}"))?;
        Self::sync_workspace(db, workspace_id)
    }

    /// 切换工作空间直绑 skill，并触发同步
    pub fn toggle_skill(db: &Arc<Database>, workspace_id: &str, skill_id: &str, active: bool) -> Result<()> {
        db.toggle_workspace_skill(workspace_id, skill_id, active)
            .map_err(|e| anyhow!("{e}"))?;
        Self::sync_workspace(db, workspace_id)
    }

    /// 获取工作空间绑定详情（分组 ids、直绑 skill ids、并集技能总数）
    pub fn get_bindings(db: &Arc<Database>, workspace_id: &str) -> Result<WorkspaceBindings> {
        let group_ids = db.get_workspace_group_bindings(workspace_id)
            .map_err(|e| anyhow!("{e}"))?;
        let skill_ids = db.get_workspace_skill_bindings(workspace_id)
            .map_err(|e| anyhow!("{e}"))?;

        let mut all_skill_ids: std::collections::HashSet<String> = skill_ids.iter().cloned().collect();
        for gid in &group_ids {
            let members = db.get_group_member_ids(gid).map_err(|e| anyhow!("{e}"))?;
            all_skill_ids.extend(members);
        }

        Ok(WorkspaceBindings {
            group_ids,
            skill_ids,
            total_skill_count: all_skill_ids.len(),
        })
    }

    /// 核心同步：计算工作空间 skill 并集，全量同步到文件系统
    /// 并集 = 直绑 skill ∪ 所有绑定分组的成员
    /// 每个 skill 同步的 app 目录由 skill.apps.enabled_apps() 决定
    pub fn sync_workspace(db: &Arc<Database>, workspace_id: &str) -> Result<()> {
        let workspace = db.get_workspace(workspace_id)
            .map_err(|e| anyhow!("{e}"))?
            .ok_or_else(|| anyhow!("工作空间不存在: {workspace_id}"))?;

        let group_ids = db.get_workspace_group_bindings(workspace_id)
            .map_err(|e| anyhow!("{e}"))?;
        let direct_skill_ids = db.get_workspace_skill_bindings(workspace_id)
            .map_err(|e| anyhow!("{e}"))?;

        let mut skill_ids: std::collections::HashSet<String> =
            direct_skill_ids.into_iter().collect();
        for gid in &group_ids {
            let members = db.get_group_member_ids(gid).map_err(|e| anyhow!("{e}"))?;
            skill_ids.extend(members);
        }

        if workspace.is_user_level {
            Self::sync_skills_to_global(db, &skill_ids)?;
        } else {
            Self::sync_skills_to_path(db, &skill_ids, &workspace.path)?;
        }

        Ok(())
    }

    /// 当分组成员变化时，同步所有绑定该分组的工作空间
    pub fn sync_workspaces_for_group(db: &Arc<Database>, group_id: &str) -> Result<()> {
        let workspace_ids = db.get_workspaces_with_group_binding(group_id)
            .map_err(|e| anyhow!("{e}"))?;
        for workspace_id in &workspace_ids {
            if let Err(e) = Self::sync_workspace(db, workspace_id) {
                log::warn!("sync_workspaces_for_group: 工作空间 {workspace_id} 同步失败: {e}");
            }
        }
        Ok(())
    }

    fn sync_skills_to_global(db: &Arc<Database>, skill_ids: &std::collections::HashSet<String>) -> Result<()> {
        SkillService::disable_all_skills(db)?;
        for skill_id in skill_ids {
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

    fn sync_skills_to_path(db: &Arc<Database>, skill_ids: &std::collections::HashSet<String>, workspace_path: &str) -> Result<()> {
        use crate::app_config::AppType;
        use std::path::PathBuf;

        let base = PathBuf::from(workspace_path);
        let ssot_dir = SkillService::get_ssot_dir()?;

        // 各 app 的局部 skills 目录
        let app_skill_dirs: Vec<(AppType, PathBuf)> = vec![
            (AppType::Claude,   base.join(".claude").join("skills")),
            (AppType::Codex,    base.join(".codex").join("skills")),
            (AppType::Gemini,   base.join(".gemini").join("skills")),
            (AppType::OpenCode, base.join(".config").join("opencode").join("skills")),
        ];

        // 清空各局部 skills 目录中的 symlink/子目录
        for (_, dir) in &app_skill_dirs {
            if dir.exists() {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        let _ = if path.is_symlink() || path.is_file() {
                            std::fs::remove_file(&path)
                        } else {
                            std::fs::remove_dir_all(&path)
                        };
                    }
                }
            }
        }

        // 同步 skill 到对应 app 目录
        for skill_id in skill_ids {
            if let Ok(Some(skill)) = db.get_installed_skill(skill_id) {
                let source = ssot_dir.join(&skill.directory);
                if !source.exists() {
                    continue;
                }
                for app in skill.apps.enabled_apps() {
                    let dest_dir = match app {
                        AppType::Claude   => base.join(".claude").join("skills"),
                        AppType::Codex    => base.join(".codex").join("skills"),
                        AppType::Gemini   => base.join(".gemini").join("skills"),
                        AppType::OpenCode => base.join(".config").join("opencode").join("skills"),
                        AppType::Hermes | AppType::OpenClaw => continue,
                    };
                    let _ = std::fs::create_dir_all(&dest_dir);
                    let dest = dest_dir.join(&skill.directory);
                    if dest.exists() || dest.is_symlink() {
                        let _ = if dest.is_symlink() || dest.is_file() {
                            std::fs::remove_file(&dest)
                        } else {
                            std::fs::remove_dir_all(&dest)
                        };
                    }
                    #[cfg(unix)]
                    if let Err(e) = std::os::unix::fs::symlink(&source, &dest) {
                        log::warn!("sync_path: symlink {:?} -> {:?} 失败: {e}", source, dest);
                    }
                    #[cfg(windows)]
                    if let Err(e) = std::os::windows::fs::symlink_dir(&source, &dest) {
                        log::warn!("sync_path: symlink {:?} -> {:?} 失败: {e}", source, dest);
                    }
                }
            }
        }
        Ok(())
    }
}
