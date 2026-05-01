//! WorkspaceSkill 业务逻辑层

use crate::database::Database;
use crate::services::skill::SkillService;
use anyhow::{anyhow, Result};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

pub struct ApplyResult {
    pub synced: usize,
    pub failed: Vec<String>,
}

pub struct WorkspaceSkillService;

impl WorkspaceSkillService {
    /// 将工作空间所有绑定分组的成员 Skill 同步到 <path>/.claude/skills/
    pub fn apply(db: &Arc<Database>, workspace_id: &str) -> Result<ApplyResult> {
        let ws = db
            .get_workspace(workspace_id)
            .map_err(|e| anyhow!("{e}"))?
            .ok_or_else(|| anyhow!("工作空间不存在: {workspace_id}"))?;

        let group_ids = db
            .get_workspace_group_ids(workspace_id)
            .map_err(|e| anyhow!("{e}"))?;

        // 收集所有分组成员 skill_id（去重）
        let mut skill_ids: HashSet<String> = HashSet::new();
        for group_id in &group_ids {
            let members = db
                .get_group_member_ids(group_id)
                .map_err(|e| anyhow!("{e}"))?;
            skill_ids.extend(members);
        }

        let target_skills_dir = Path::new(&ws.path).join(".claude").join("skills");
        std::fs::create_dir_all(&target_skills_dir)
            .map_err(|e| anyhow!("创建目录失败 {}: {e}", target_skills_dir.display()))?;

        let ssot_dir = SkillService::get_ssot_dir()?;

        let mut synced = 0usize;
        let mut failed: Vec<String> = Vec::new();

        for skill_id in &skill_ids {
            match db.get_installed_skill(skill_id) {
                Ok(Some(skill)) => {
                    let source = ssot_dir.join(&skill.directory);
                    if !source.exists() {
                        log::warn!("apply_workspace: SSOT skill {} 不存在，跳过", skill.name);
                        failed.push(skill.name.clone());
                        continue;
                    }
                    let dest = target_skills_dir.join(&skill.directory);
                    if dest.exists() {
                        synced += 1;
                        continue;
                    }
                    match Self::create_symlink(&source, &dest) {
                        Ok(()) => synced += 1,
                        Err(e) => {
                            log::warn!("apply_workspace: symlink skill {} 失败: {e}，尝试复制", skill.name);
                            match Self::copy_dir(&source, &dest) {
                                Ok(()) => synced += 1,
                                Err(e2) => {
                                    log::warn!("apply_workspace: 复制 skill {} 失败: {e2}", skill.name);
                                    failed.push(skill.name.clone());
                                }
                            }
                        }
                    }
                }
                Ok(None) => log::warn!("apply_workspace: skill {skill_id} 不存在，跳过"),
                Err(e) => log::warn!("apply_workspace: 读取 skill {skill_id} 失败: {e}"),
            }
        }

        Ok(ApplyResult { synced, failed })
    }

    fn create_symlink(source: &Path, dest: &Path) -> Result<()> {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(source, dest)?;
        }
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_dir(source, dest)?;
        }
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
