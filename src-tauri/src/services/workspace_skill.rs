//! WorkspaceSkill 业务逻辑层

use crate::database::Database;
use crate::services::skill::SkillService;
use anyhow::{anyhow, Result};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

pub struct WorkspaceSkillService;

impl WorkspaceSkillService {
    /// 切换工作空间中某分组的激活状态，并立即同步目录
    pub fn toggle_group(
        db: &Arc<Database>,
        workspace_id: &str,
        group_id: &str,
        active: bool,
    ) -> Result<()> {
        db.get_workspace(workspace_id)
            .map_err(|e| anyhow!("{e}"))?
            .ok_or_else(|| anyhow!("工作空间不存在: {workspace_id}"))?;
        db.toggle_workspace_group_active(workspace_id, group_id, active)
            .map_err(|e| anyhow!("{e}"))?;
        Self::sync_active_groups_to_workspace(db, workspace_id)
    }

    /// 计算工作空间已激活分组的成员 skill 并集，全量同步到 <path>/.claude/skills/
    pub fn sync_active_groups_to_workspace(db: &Arc<Database>, workspace_id: &str) -> Result<()> {
        let ws = db
            .get_workspace(workspace_id)
            .map_err(|e| anyhow!("{e}"))?
            .ok_or_else(|| anyhow!("工作空间不存在: {workspace_id}"))?;

        let active_group_ids = db
            .get_workspace_active_group_ids(workspace_id)
            .map_err(|e| anyhow!("{e}"))?;

        let mut skill_ids: HashSet<String> = HashSet::new();
        for gid in &active_group_ids {
            let members = db.get_group_member_ids(gid).map_err(|e| anyhow!("{e}"))?;
            skill_ids.extend(members);
        }

        let target_skills_dir = Path::new(&ws.path).join(".claude").join("skills");
        std::fs::create_dir_all(&target_skills_dir)
            .map_err(|e| anyhow!("创建目录失败 {}: {e}", target_skills_dir.display()))?;

        // 清空目录中现有 symlink（全量替换）
        Self::clear_skills_dir(&target_skills_dir)?;

        let ssot_dir = SkillService::get_ssot_dir()?;

        for skill_id in &skill_ids {
            match db.get_installed_skill(skill_id) {
                Ok(Some(skill)) => {
                    let source = ssot_dir.join(&skill.directory);
                    if !source.exists() {
                        log::warn!("sync_workspace: SSOT skill {} 不存在", skill.name);
                        continue;
                    }
                    let dest = target_skills_dir.join(&skill.directory);
                    match Self::create_symlink(&source, &dest) {
                        Ok(()) => {}
                        Err(e) => {
                            log::warn!("sync_workspace: symlink {} 失败: {e}", skill.name);
                            let _ = std::fs::remove_dir_all(&dest);
                            if let Err(e2) = Self::copy_dir(&source, &dest) {
                                log::warn!("sync_workspace: copy {} 失败: {e2}", skill.name);
                            }
                        }
                    }
                }
                Ok(None) => log::warn!("sync_workspace: skill {skill_id} 不存在"),
                Err(e) => log::warn!("sync_workspace: 读取 skill {skill_id} 失败: {e}"),
            }
        }

        Ok(())
    }

    /// 当分组成员变化时，同步所有受影响的工作空间
    pub fn sync_workspaces_for_group(db: &Arc<Database>, group_id: &str) -> Result<()> {
        let workspace_ids = db
            .get_workspaces_with_active_group(group_id)
            .map_err(|e| anyhow!("{e}"))?;
        for workspace_id in &workspace_ids {
            if let Err(e) = Self::sync_active_groups_to_workspace(db, workspace_id) {
                log::warn!("sync_workspaces_for_group: 工作空间 {workspace_id} 同步失败: {e}");
            }
        }
        Ok(())
    }

    fn clear_skills_dir(dir: &Path) -> Result<()> {
        if !dir.exists() {
            return Ok(());
        }
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_symlink() || path.is_dir() {
                let _ = std::fs::remove_dir_all(&path);
            } else {
                let _ = std::fs::remove_file(&path);
            }
        }
        Ok(())
    }

    fn create_symlink(source: &Path, dest: &Path) -> Result<()> {
        #[cfg(unix)]
        { std::os::unix::fs::symlink(source, dest)?; }
        #[cfg(windows)]
        { std::os::windows::fs::symlink_dir(source, dest)?; }
        Ok(())
    }

    fn copy_dir(source: &Path, dest: &Path) -> Result<()> {
        std::fs::create_dir_all(dest)?;
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            let dest_path = dest.join(entry.file_name());
            if entry.file_type()?.is_dir() {
                Self::copy_dir(&entry.path(), &dest_path)?;
            } else {
                std::fs::copy(entry.path(), &dest_path)?;
            }
        }
        Ok(())
    }
}
