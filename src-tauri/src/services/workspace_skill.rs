//! WorkspaceSkill 业务逻辑层

use crate::app_config::AppType;
use crate::database::dao::skill_groups::SkillGroupApps;
use crate::database::Database;
use crate::services::skill::{SkillService, SkillSyncFailure, SyncMethod};
use anyhow::{anyhow, Context, Result};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// 技能目录清单文件名，记录由 cc-switch 管理的 skill 目录列表。
/// 位于各应用的 `skills/` 下，JSON 字符串数组格式。
const MANAGED_MANIFEST_FILENAME: &str = ".cc-switch-managed.json";

/// 所有权标记文件名。copy fallback 部署时在目标目录内写入该空文件，
/// bootstrap 通过检测该标记确认目录归属，避免误判用户自建同名目录。
const MANAGED_MARKER: &str = ".cc-switch-managed";

pub struct WorkspaceSkillService;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBindings {
    pub group_ids: Vec<String>,
    pub skill_ids: Vec<String>,
    pub total_skill_count: usize,
}

impl WorkspaceSkillService {
    /// 切换工作空间中某分组的激活状态，并立即同步目录
    pub fn toggle_group(
        db: &Arc<Database>,
        workspace_id: &str,
        group_id: &str,
        active: bool,
    ) -> Result<()> {
        let workspace = db
            .get_workspace(workspace_id)
            .map_err(|e| anyhow!("{e}"))?
            .ok_or_else(|| anyhow!("工作空间不存在: {workspace_id}"))?;
        db.toggle_workspace_group_active(workspace_id, group_id, active)
            .map_err(|e| anyhow!("{e}"))?;
        if workspace.is_user_level {
            Self::sync_global(db)
        } else {
            Self::sync_active_groups_to_workspace(db, workspace_id)
        }
    }

    /// 切换工作空间直接绑定的 Skill，并立即同步目录。
    pub fn toggle_skill(
        db: &Arc<Database>,
        workspace_id: &str,
        skill_id: &str,
        active: bool,
    ) -> Result<()> {
        let workspace = db
            .get_workspace(workspace_id)
            .map_err(|e| anyhow!("{e}"))?
            .ok_or_else(|| anyhow!("工作空间不存在: {workspace_id}"))?;
        db.toggle_workspace_skill(workspace_id, skill_id, active)
            .map_err(|e| anyhow!("{e}"))?;
        if workspace.is_user_level {
            Self::sync_global(db)
        } else {
            Self::sync_active_groups_to_workspace(db, workspace_id)
        }
    }

    /// 获取当前激活分组、直接绑定 Skill 及两者的去重 Skill 总数。
    pub fn get_bindings(db: &Arc<Database>, workspace_id: &str) -> Result<WorkspaceBindings> {
        let group_ids = db
            .get_workspace_active_group_ids(workspace_id)
            .map_err(|e| anyhow!("{e}"))?;
        let skill_ids = db
            .get_workspace_skill_bindings(workspace_id)
            .map_err(|e| anyhow!("{e}"))?;

        let mut all_skill_ids: HashSet<String> = skill_ids.iter().cloned().collect();
        for group_id in &group_ids {
            let members = db
                .get_group_member_ids(group_id)
                .map_err(|e| anyhow!("{e}"))?;
            all_skill_ids.extend(members);
        }

        Ok(WorkspaceBindings {
            group_ids,
            skill_ids,
            total_skill_count: all_skill_ids.len(),
        })
    }

    /// 全局选择集唯一口径：全局激活分组成员与用户级工作空间直绑 Skill 的并集。
    #[cfg(test)]
    fn collect_global_skill_ids(db: &Arc<Database>) -> Result<HashSet<String>> {
        let active_group_ids = db
            .get_active_skill_group_ids()
            .map_err(|e| anyhow!("{e}"))?;
        let mut skill_ids: HashSet<String> = db
            .get_user_level_workspace_skill_bindings()
            .map_err(|e| anyhow!("{e}"))?
            .into_iter()
            .collect();
        for group_id in &active_group_ids {
            skill_ids.extend(
                db.get_group_member_ids(group_id)
                    .map_err(|e| anyhow!("{e}"))?,
            );
        }
        Ok(skill_ids)
    }

    fn group_enabled_for(apps: &SkillGroupApps, app: &AppType) -> bool {
        match app {
            AppType::Claude => apps.claude,
            AppType::Codex => apps.codex,
            AppType::Gemini => apps.gemini,
            AppType::OpenCode => apps.opencode,
            AppType::Hermes => apps.hermes,
            _ => false,
        }
    }

    fn collect_skill_ids_for_app(
        db: &Arc<Database>,
        group_ids: &[String],
        direct_ids: Vec<String>,
        app: &AppType,
    ) -> Result<HashSet<String>> {
        let mut skill_ids: HashSet<String> = direct_ids.into_iter().collect();
        for group_id in group_ids {
            if let Some(group) = db.get_skill_group(group_id)? {
                if Self::group_enabled_for(&group.apps, app) {
                    skill_ids.extend(db.get_group_member_ids(group_id)?);
                }
            }
        }
        Ok(skill_ids)
    }

    pub(crate) fn collect_global_skill_ids_for_app(
        db: &Arc<Database>,
        app: &AppType,
    ) -> Result<HashSet<String>> {
        Self::collect_skill_ids_for_app(
            db,
            &db.get_active_skill_group_ids()?,
            db.get_user_level_workspace_skill_bindings()?,
            app,
        )
    }

    /// 按全局选择集刷新各应用目录，保留每个 Skill 自身的 app 开关。
    pub fn sync_global(db: &Arc<Database>) -> Result<()> {
        for app in [
            AppType::Claude,
            AppType::Codex,
            AppType::Gemini,
            AppType::OpenCode,
            AppType::Hermes,
        ] {
            SkillService::sync_global_to_app(db, &app, None)?;
        }
        Ok(())
    }

    /// 计算工作空间已激活分组成员与直接绑定 Skill 的并集，
    /// 按应用开关同步到项目的 `.claude/skills/` 与 `.agents/skills/`。
    ///
    /// 仅操作由 cc-switch 管理的条目（通过清单文件追踪），
    /// 不会误删用户手动放置或其他工具管理的文件/目录。
    pub fn sync_active_groups_to_workspace(db: &Arc<Database>, workspace_id: &str) -> Result<()> {
        Self::sync_workspace_with_previous_ssot(db, workspace_id, None)
    }

    pub(crate) fn sync_workspace_with_previous_ssot(
        db: &Arc<Database>,
        workspace_id: &str,
        previous_ssot: Option<&Path>,
    ) -> Result<()> {
        let ws = db
            .get_workspace(workspace_id)
            .map_err(|e| anyhow!("{e}"))?
            .ok_or_else(|| anyhow!("工作空间不存在: {workspace_id}"))?;

        // 用户级工作空间只管理全局 app 目录，必须在任何项目路径/manifest 操作前返回。
        if ws.is_user_level {
            return Self::sync_global(db);
        }

        let active_group_ids = db
            .get_workspace_active_group_ids(workspace_id)
            .map_err(|e| anyhow!("{e}"))?;

        let direct_ids = db
            .get_workspace_skill_bindings(workspace_id)
            .map_err(|e| anyhow!("{e}"))?;
        let ssot_dir = SkillService::get_ssot_dir()?;
        let roots = Self::workspace_roots(db, &ws.path)?;
        for (app, app_directory) in [(AppType::Claude, ".claude"), (AppType::Codex, ".agents")] {
            let skill_ids =
                Self::collect_skill_ids_for_app(db, &active_group_ids, direct_ids.clone(), &app)?;
            for root in &roots {
                Self::sync_skills_to_directory(
                    db,
                    &skill_ids,
                    &app,
                    &root.join(app_directory).join("skills"),
                    &ssot_dir,
                    previous_ssot,
                    true,
                )?;
            }
        }
        Ok(())
    }

    /// 非 Git 目录工作空间也投影到直接 Git 子仓库，独立注册的工作空间优先。
    fn workspace_roots(db: &Arc<Database>, path: &str) -> Result<Vec<PathBuf>> {
        let root = PathBuf::from(path);
        let mut roots = vec![root.clone()];
        if root.join(".git").exists() {
            return Ok(roots);
        }
        let registered = db.get_all_workspaces()?;
        if let Ok(entries) = std::fs::read_dir(&root) {
            for entry in entries {
                let child = entry?.path();
                if child.is_dir()
                    && child.join(".git").exists()
                    && !registered.iter().any(|workspace| {
                        !workspace.is_user_level
                            && SkillService::paths_alias(&child, Path::new(&workspace.path))
                    })
                {
                    roots.push(child);
                }
            }
        }
        roots.sort();
        Ok(roots)
    }

    /// 复用清单和所有权标记投影选择集；迁移时也认可旧 SSOT 的受管链接。
    pub(crate) fn sync_skills_to_directory(
        db: &Arc<Database>,
        skill_ids: &HashSet<String>,
        app: &AppType,
        target_skills_dir: &Path,
        ssot_dir: &Path,
        previous_ssot: Option<&Path>,
        allow_legacy_copies: bool,
    ) -> Result<Vec<SkillSyncFailure>> {
        let mut failed = Vec::new();
        // Unified 存储与 Codex 全局目录可能相同，不能将 SSOT 当成投影清理。
        if SkillService::paths_alias(target_skills_dir, ssot_dir) {
            return Ok(failed);
        }
        if skill_ids.is_empty() && !target_skills_dir.exists() {
            return Ok(failed);
        }
        std::fs::create_dir_all(target_skills_dir)
            .map_err(|e| anyhow!("创建目录失败 {}: {e}", target_skills_dir.display()))?;

        // 读取上次同步时记录的清单，得知哪些条目是本功能管理的。
        // 读取失败（如 JSON 损坏）时传播错误以跳过本轮 sync，避免覆盖旧清单丢失追踪信息。
        let mut old_managed = Self::read_skills_manifest(target_skills_dir)
            .map_err(|e| anyhow!("读取 skills 清单失败，跳过本轮同步以保留旧清单: {e}"))?;

        // 引导：仅当 manifest 文件不存在时（首次 sync 或新升级）扫描已有管理条目。
        // 文件存在但内容为空（[]）表示已 bootstrap 过且无条目，不应重入。
        let manifest_path = Self::manifest_path(target_skills_dir);
        if !manifest_path.exists() {
            let mut bootstrapped =
                Self::bootstrap_managed_entries(target_skills_dir, ssot_dir, allow_legacy_copies);
            if let Some(previous) = previous_ssot {
                bootstrapped.extend(Self::bootstrap_managed_entries(
                    target_skills_dir,
                    previous,
                    allow_legacy_copies,
                ));
            }
            if !bootstrapped.is_empty() {
                log::info!(
                    "sync_workspace: 检测到 {} 个已有管理条目，自动纳入清单",
                    bootstrapped.len()
                );
                old_managed = bootstrapped;
            }
        }

        // 恢复孤儿条目：磁盘上存在管理条目（copy 标记或指向 SSOT 的 symlink）
        // 但 manifest 中缺失的。典型场景：上一轮 sync 部署了条目但 manifest 写入失败。
        let mut recovered =
            Self::recover_orphaned_managed(target_skills_dir, &old_managed, ssot_dir);
        if let Some(previous) = previous_ssot {
            recovered.extend(Self::recover_orphaned_managed(
                target_skills_dir,
                &old_managed,
                previous,
            ));
        }
        if !recovered.is_empty() {
            log::info!(
                "sync_workspace: 恢复 {} 个孤儿管理条目（磁盘存在但清单未记录）",
                recovered.len()
            );
            old_managed.extend(recovered);
        }

        // 本次将管理的 skill 目录名集合
        let mut new_managed: HashSet<String> = HashSet::new();

        for skill_id in skill_ids {
            match db.get_installed_skill(skill_id) {
                Ok(Some(skill)) => {
                    if !skill.apps.is_enabled_for(app) {
                        continue;
                    }
                    if !Self::is_safe_manifest_entry(&skill.directory) {
                        log::warn!("sync_workspace: 跳过非法 skill 目录 {:?}", skill.directory);
                        failed.push(SkillSyncFailure {
                            directory: skill.directory.clone(),
                            error: format!("非法 skill 目录 {:?}", skill.directory),
                        });
                        continue;
                    }
                    let source = ssot_dir.join(&skill.directory);
                    let source_file = source.join("SKILL.md");
                    match std::fs::metadata(&source_file) {
                        Ok(metadata) if metadata.is_file() => {}
                        metadata => {
                            let error = match metadata {
                                Ok(_) => format!("Skill 来源不是文件: {}", source_file.display()),
                                Err(error) => format!(
                                    "读取 Skill 来源 {} 失败: {error}",
                                    source_file.display()
                                ),
                            };
                            log::warn!("sync_workspace: {error}");
                            failed.push(SkillSyncFailure {
                                directory: skill.directory.clone(),
                                error,
                            });
                            continue;
                        }
                    }
                    let dest = target_skills_dir.join(&skill.directory);

                    // 仅当目标已由我们管理（在旧清单中）且文件系统仍归我们所有时，
                    // 才移除旧条目。用户可能在清单记录后手动替换了部署内容。
                    if old_managed.contains(&skill.directory) {
                        if dest.exists() || dest.is_symlink() {
                            if Self::is_still_managed(&dest, ssot_dir)
                                || previous_ssot
                                    .is_some_and(|previous| Self::is_still_managed(&dest, previous))
                            {
                                if let Err(error) = SkillService::remove_path(&dest) {
                                    log::warn!(
                                        "sync_workspace: 移除旧 Skill {} 失败: {error:#}",
                                        dest.display()
                                    );
                                    failed.push(SkillSyncFailure {
                                        directory: skill.directory.clone(),
                                        error: format!(
                                            "移除旧 Skill {} 失败: {error:#}",
                                            dest.display()
                                        ),
                                    });
                                    new_managed.insert(skill.directory.clone());
                                    continue;
                                }
                            } else {
                                log::warn!(
                                    "sync_workspace: skill {} 条目已被用户替换，跳过删除",
                                    skill.name
                                );
                                failed.push(SkillSyncFailure {
                                    directory: skill.directory.clone(),
                                    error: format!(
                                        "Skill 目标 {} 已被用户替换，非本工具管理",
                                        dest.display()
                                    ),
                                });
                                continue;
                            }
                        }
                    }

                    let deployed = Self::deploy_skill(
                        &source,
                        &dest,
                        &skill.directory,
                        &skill.name,
                        &old_managed,
                    );

                    // 仅当部署成功时才加入清单，
                    // 避免跳过未部署的 skill 被后续同步当作工具管理的目录误删。
                    match deployed {
                        Ok(()) => {
                            new_managed.insert(skill.directory.clone());
                        }
                        Err(error) => {
                            log::warn!("sync_workspace: 部署 Skill {} 失败: {error:#}", skill.name);
                            failed.push(SkillSyncFailure {
                                directory: skill.directory.clone(),
                                error: format!("部署 Skill 到 {} 失败: {error:#}", dest.display()),
                            });
                        }
                    }
                }
                Ok(None) => {
                    log::warn!("sync_workspace: skill {skill_id} 不存在");
                    failed.push(SkillSyncFailure {
                        directory: skill_id.clone(),
                        error: format!("skill {skill_id} 不存在"),
                    });
                }
                Err(error) => {
                    log::warn!("sync_workspace: 读取 skill {skill_id} 失败: {error}");
                    failed.push(SkillSyncFailure {
                        directory: skill_id.clone(),
                        error: format!("读取 skill {skill_id} 失败: {error}"),
                    });
                }
            }
        }

        // 清理旧清单中本次不再激活的条目（仅移除我们管理的，不动其他文件）
        let cleanup_failed = Self::cleanup_stale_entries(
            target_skills_dir,
            &old_managed,
            &new_managed,
            ssot_dir,
            previous_ssot,
        );
        // 删除失败（如锁占用）的条目保留在 manifest 中，下次 sync 重试
        if !cleanup_failed.is_empty() {
            log::warn!(
                "sync_workspace: {} 个条目清理失败，保留在清单中等待下次重试",
                cleanup_failed.len()
            );
            new_managed.extend(
                cleanup_failed
                    .iter()
                    .map(|failure| failure.directory.clone()),
            );
            failed.extend(cleanup_failed);
        }

        // 持久化本次清单。写入失败时整个 sync 返回错误，
        // 避免新部署的条目在下次 sync 因清单缺失而丢失追踪。
        Self::write_skills_manifest(target_skills_dir, &new_managed)
            .map_err(|e| anyhow!("写入 skills 清单失败，本轮同步未持久化: {e}"))?;

        Ok(failed)
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

    /// 当技能的应用启用状态变化时，同步所有直接绑定或经激活分组包含该技能的工作空间。
    pub fn sync_workspaces_for_skill(db: &Arc<Database>, skill_id: &str) -> Result<()> {
        let workspace_ids = db
            .get_workspaces_containing_skill(skill_id)
            .map_err(|e| anyhow!("{e}"))?;
        for workspace_id in &workspace_ids {
            if let Err(e) = Self::sync_active_groups_to_workspace(db, workspace_id) {
                log::warn!("sync_workspaces_for_skill: 工作空间 {workspace_id} 同步失败: {e}");
            }
        }
        Ok(())
    }

    // ─── 部署逻辑 ──────────────────────────────────────────────────

    /// 将 source 部署到 dest（优先 symlink，fallback 复制）。
    /// 保留部署失败的原始错误，供逐 Skill 同步结果报告。
    fn deploy_skill(
        source: &Path,
        dest: &Path,
        dir_name: &str,
        skill_name: &str,
        old_managed: &HashSet<String>,
    ) -> Result<()> {
        let sync_method = crate::settings::get_skill_sync_method();
        if sync_method == SyncMethod::Copy {
            if (dest.exists() || dest.is_symlink()) && !old_managed.contains(dir_name) {
                return Err(anyhow!(
                    "Skill 目标 {} 已存在且非本工具管理",
                    dest.display()
                ));
            }
            return Self::copy_dir_and_mark(source, dest);
        }
        match Self::create_symlink(source, dest) {
            Ok(()) => Ok(()),
            Err(e) => {
                log::warn!("sync_workspace: symlink {} 失败: {e}", skill_name);
                if sync_method == SyncMethod::Symlink {
                    return Err(e);
                }

                if old_managed.contains(dir_name) {
                    // 调用者已在上方验证所有权并删除旧条目，
                    // 此处直接 copy 重建即可，无需重复 remove_dir_all。
                    Self::copy_dir_and_mark(source, dest)
                        .with_context(|| format!("symlink {skill_name} 失败: {e:#}；复制回退失败"))
                } else if dest.exists() || dest.is_symlink() {
                    // 目标存在但不是我们管理的 → 不触碰
                    log::warn!(
                        "sync_workspace: skill {} 的目录已存在且非本工具管理，跳过",
                        skill_name
                    );
                    Err(anyhow!(
                        "Skill 目标 {} 已存在且非本工具管理；symlink 失败: {e:#}",
                        dest.display()
                    ))
                } else {
                    // 目标不存在（全新部署且 symlink 不可用）→ 走复制 fallback
                    log::info!(
                        "sync_workspace: symlink 不受支持，使用复制方式部署 {}",
                        skill_name
                    );
                    Self::copy_dir_and_mark(source, dest)
                        .with_context(|| format!("symlink {skill_name} 失败: {e:#}；复制回退失败"))
                }
            }
        }
    }

    /// copy_dir + 写入所有权标记文件（`.cc-switch-managed`）。
    ///
    /// 标记是 `is_still_managed` 的唯一依据（对 copy 部署）。若标记写入失败
    /// 但返回 Ok，后续 sync 会因标记缺失将目录当作"用户文件"永久跳过，
    /// 形成不可恢复的僵尸条目。因此标记写入失败时清理已 copy 的目录并返回错误。
    fn copy_dir_and_mark(source: &Path, dest: &Path) -> Result<()> {
        Self::copy_dir(source, dest)?;
        std::fs::write(dest.join(MANAGED_MARKER), "").map_err(|e| {
            // 清理已 copy 的目录，避免残留被误判为用户文件
            let _ = std::fs::remove_dir_all(dest);
            anyhow!("写入所有权标记失败 ({}): {e}", dest.display())
        })
    }

    // ─── 清单文件读写 ────────────────────────────────────────────

    /// 返回清单文件路径：`<skills_dir>/<MANAGED_MANIFEST_FILENAME>`
    fn manifest_path(skills_dir: &Path) -> PathBuf {
        skills_dir.join(MANAGED_MANIFEST_FILENAME)
    }

    /// 读取清单，返回由本功能管理的 skill 目录名集合。
    /// 若清单文件不存在，返回空集合（非错误）。
    /// 自动过滤包含路径穿越字符的非法条目。
    fn read_skills_manifest(skills_dir: &Path) -> Result<HashSet<String>> {
        let path = Self::manifest_path(skills_dir);
        if !path.exists() {
            return Ok(HashSet::new());
        }
        let content = std::fs::read_to_string(&path).map_err(|e| anyhow!("读取清单失败: {e}"))?;
        let entries: Vec<String> =
            serde_json::from_str(&content).map_err(|e| anyhow!("解析清单失败: {e}"))?;
        let mut safe = HashSet::new();
        for entry in entries {
            if Self::is_safe_manifest_entry(&entry) {
                safe.insert(entry);
            } else {
                log::warn!(
                    "sync_workspace: 清单中存在非法条目（路径穿越或空名） {:?}，已跳过",
                    entry
                );
            }
        }
        Ok(safe)
    }

    /// 将本次管理的 skill 目录名集合写入清单文件。
    ///
    /// 采用原子写入：先写临时文件再 rename，避免中途崩溃留下残缺 JSON
    /// 导致后续 sync 因解析错误永久阻塞。
    fn write_skills_manifest(skills_dir: &Path, managed: &HashSet<String>) -> Result<()> {
        let path = Self::manifest_path(skills_dir);
        let mut list: Vec<&String> = managed.iter().collect();
        list.sort(); // 稳定输出，便于 diff
        let content =
            serde_json::to_string_pretty(&list).map_err(|e| anyhow!("序列化清单失败: {e}"))?;

        let tmp_path = path.with_extension(".tmp");
        std::fs::write(&tmp_path, &content).map_err(|e| anyhow!("写入清单临时文件失败: {e}"))?;
        // Windows 上 rename 在目标已存在时失败，先 remove_file 保证跨平台兼容。
        // Unix 上这一步是 no-op 或早已被 rename 原子替换；最多牺牲极小原子性窗口。
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| anyhow!("移除旧清单文件失败: {e}"))?;
        }
        std::fs::rename(&tmp_path, &path).map_err(|e| anyhow!("提交清单文件失败: {e}"))?;
        Ok(())
    }

    /// 引导扫描：manifest 为空时，检测 skills_dir 中已有的管理条目并纳入清单。
    ///
    /// 识别三类条目：
    /// 1. 指向 SSOT 目录的 symlink（常规部署）
    /// 2. 包含 `.cc-switch-managed` 标记文件的目录（新版 copy fallback 部署）
    /// 3. 内容与 SSOT 源一致的遗留 copy 目录（老版本部署，一次性补标记迁移）
    fn bootstrap_managed_entries(
        skills_dir: &Path,
        ssot_dir: &Path,
        allow_legacy_copies: bool,
    ) -> HashSet<String> {
        let mut bootstrapped = HashSet::new();
        let dir = match std::fs::read_dir(skills_dir) {
            Ok(d) => d,
            Err(_) => return bootstrapped,
        };
        for entry in dir.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let name = name.to_string();
            if !Self::is_safe_manifest_entry(&name) {
                continue;
            }

            let is_managed = if path.is_symlink() {
                // symlink 部署：目标必须在 SSOT 目录内
                SkillService::is_symlink_to_ssot(&path, ssot_dir)
            } else if path.is_dir() {
                if path.join(MANAGED_MARKER).exists() {
                    // 新版 copy 部署：有所有权标记
                    true
                } else if allow_legacy_copies {
                    // 遗留 copy 部署（无标记）：需要更强的所有权验证。
                    // 仅当候选目录的所有顶层文件都存在于 SSOT 同名目录中时，
                    // 才认定为我们部署的（内容一致 = 我们写的，有额外文件 = 用户改过的）。
                    let ssot_source = ssot_dir.join(&name);
                    ssot_source.is_dir() && Self::is_subset_of_ssot(&path, &ssot_source)
                } else {
                    // 全局目录也由其他工具和用户管理，内容相同不能证明所有权。
                    false
                }
            } else {
                false
            };

            if is_managed {
                // 对无标记的遗留目录补写标记，完成一次性迁移
                if !path.is_symlink() && path.is_dir() && !path.join(MANAGED_MARKER).exists() {
                    log::info!("sync_workspace: 为遗留 copy 部署 {} 补写所有权标记", name);
                    if std::fs::write(path.join(MANAGED_MARKER), "").is_err() {
                        continue;
                    }
                }
                bootstrapped.insert(name);
            }
        }
        bootstrapped
    }

    /// 恢复孤儿条目：扫描 skills_dir 中属于我们管理但不在 `old_managed` 中的条目。
    ///
    /// 识别两类：
    /// 1. 有 `.cc-switch-managed` 标记的 copy 部署目录
    /// 2. 指向 SSOT 目录的 symlink
    ///
    /// 典型场景：上一轮 sync 部署成功但 manifest 写入失败。
    fn recover_orphaned_managed(
        skills_dir: &Path,
        old_managed: &HashSet<String>,
        ssot_dir: &Path,
    ) -> HashSet<String> {
        let mut recovered = HashSet::new();
        let dir = match std::fs::read_dir(skills_dir) {
            Ok(d) => d,
            Err(_) => return recovered,
        };
        for entry in dir.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let name = name.to_string();
            if !Self::is_safe_manifest_entry(&name) || old_managed.contains(&name) {
                continue;
            }

            let ours = if path.is_symlink() {
                // symlink 指向 SSOT → 我们的
                SkillService::is_symlink_to_ssot(&path, ssot_dir)
            } else if path.is_dir() {
                // copy 部署 → 有标记文件
                path.join(MANAGED_MARKER).exists()
            } else {
                false
            };

            if ours {
                recovered.insert(name);
            }
        }
        recovered
    }

    /// 检查 candidate 目录是否为 ssot_source 的副本。
    ///
    /// 递归比较目录内容：双方必须拥有完全相同的文件集合且内容逐字节一致。
    /// 单向子集不足够——用户仅含 SKILL.md 且内容恰好一致即可通过。
    fn is_subset_of_ssot(candidate: &Path, ssot_source: &Path) -> bool {
        // 双向均需满足：candidate 的所有内容在 SSOT 中且一致，
        // SSOT 的所有内容在 candidate 中且一致。
        Self::dir_content_equals(candidate, ssot_source)
    }

    /// 递归检查两个目录是否内容完全相等（相同文件集合，逐字节内容一致）。
    fn dir_content_equals(a: &Path, b: &Path) -> bool {
        // 1. a ⊆ b：a 的每个条目在 b 中存在且内容一致
        let a_entries = match std::fs::read_dir(a) {
            Ok(d) => d,
            Err(_) => return false,
        };
        let mut a_count = 0usize;
        for entry in a_entries.flatten() {
            a_count += 1;
            let name = entry.file_name();
            let b_path = b.join(&name);
            if !b_path.exists() {
                return false;
            }
            let a_path = entry.path();
            match (a_path.is_dir(), b_path.is_dir()) {
                (true, true) => {
                    if !Self::dir_content_equals(&a_path, &b_path) {
                        return false;
                    }
                }
                (false, false) => {
                    let a_content = match std::fs::read(&a_path) {
                        Ok(c) => c,
                        Err(_) => return false,
                    };
                    let b_content = match std::fs::read(&b_path) {
                        Ok(c) => c,
                        Err(_) => return false,
                    };
                    if a_content != b_content {
                        return false;
                    }
                }
                _ => return false,
            }
        }

        // 2. b ⊆ a：b 的每个条目在 a 中存在 → 已在上面验证（exists + 类型匹配）
        //    仅需额外验证 b 中没有 a 不存在的条目
        let b_entries = match std::fs::read_dir(b) {
            Ok(d) => d,
            Err(_) => return false,
        };
        let mut b_count = 0usize;
        for entry in b_entries.flatten() {
            b_count += 1;
            let a_path = a.join(entry.file_name());
            if !a_path.exists() {
                return false;
            }
            // 内容已在上方 a→b 遍历中验证，这里仅需确认条目存在
        }

        // 空目录不匹配
        a_count > 0 && b_count > 0
    }

    // ─── 安全校验 ──────────────────────────────────────────────────

    /// 校验清单条目是否为纯单层目录名，防止路径穿越攻击。
    /// 合法条目：非空、不含 `/` `\`、不为 `.` `..`。
    fn is_safe_manifest_entry(name: &str) -> bool {
        !name.is_empty()
            && !name.starts_with('.')
            && !name.contains('/')
            && !name.contains('\\')
            && name != "."
            && name != ".."
    }

    /// 校验文件系统条目是否仍归 cc-switch 所有。
    ///
    /// 用户可能在 manifest 记录后手动替换了我们的部署：
    /// - symlink → 检查 read_link 目标是否仍在 SSOT 目录内
    /// - 目录   → 检查 `.cc-switch-managed` 标记文件是否存在
    /// - 其他   → false（断链等异常情况不再视为管理条目）
    fn is_still_managed(entry_path: &Path, ssot_dir: &Path) -> bool {
        if entry_path.is_symlink() {
            SkillService::is_symlink_to_ssot(entry_path, ssot_dir)
        } else if entry_path.is_dir() {
            entry_path.join(MANAGED_MARKER).exists()
        } else {
            false
        }
    }

    // ─── 清理 ──────────────────────────────────────────────────────

    /// 清理旧清单中本次不再激活的条目（仅移除我们管理的，不动其他文件）。
    /// 每个条目在 join 前做二次安全校验，防止恶意清单导致路径穿越。
    /// 清理旧清单中本次不再激活的条目（仅移除我们管理的，不动其他文件）。
    /// 返回删除失败的条目及原始错误，调用者应保留条目等待下次重试。
    fn cleanup_stale_entries(
        skills_dir: &Path,
        old_managed: &HashSet<String>,
        new_managed: &HashSet<String>,
        ssot_dir: &Path,
        previous_ssot: Option<&Path>,
    ) -> Vec<SkillSyncFailure> {
        let mut failed = Vec::new();
        for dir_name in old_managed {
            if new_managed.contains(dir_name) {
                continue;
            }
            if !Self::is_safe_manifest_entry(dir_name) {
                log::warn!(
                    "sync_workspace: 清理时跳过非法清单条目 {:?}（可能是路径穿越）",
                    dir_name
                );
                continue;
            }
            let entry_path = skills_dir.join(dir_name);
            // 注意：断开的 symlink 会导致 exists() 返回 false，但 symlink 文件本身
            // 仍然存在（is_symlink() 返回 true）。需要同时检查以避免残留断链。
            if entry_path.exists() || entry_path.is_symlink() {
                // 删除前验证文件系统条目仍归我们所有，
                // 防止删除已被用户手动替换的目录。
                if !Self::is_still_managed(&entry_path, ssot_dir)
                    && !previous_ssot
                        .is_some_and(|previous| Self::is_still_managed(&entry_path, previous))
                {
                    log::warn!("sync_workspace: 条目 {} 已被用户替换，跳过删除", dir_name);
                    continue;
                }
                log::info!(
                    "sync_workspace: 移除已取消激活的 skill 目录 {}",
                    entry_path.display()
                );
                if let Err(e) = SkillService::remove_path(&entry_path) {
                    log::warn!(
                        "sync_workspace: 移除目录失败 ({}): {e}",
                        entry_path.display()
                    );
                    failed.push(SkillSyncFailure {
                        directory: dir_name.clone(),
                        error: format!("移除目录 {} 失败: {e:#}", entry_path.display()),
                    });
                }
            }
        }
        failed
    }

    // ─── 文件操作辅助 ─────────────────────────────────────────────

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
        // 中途失败时清理已部分写入的目标目录，避免残留被后续 sync
        // 误判为"用户文件"而永久跳过。
        let result = (|| {
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
        })();
        if result.is_err() {
            let _ = std::fs::remove_dir_all(dest);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[test]
    fn get_bindings_returns_active_groups_direct_skills_and_deduplicated_total() {
        let db = Arc::new(Database::memory().expect("create memory db"));
        {
            let conn = db.conn.lock().expect("lock conn");
            conn.execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS workspace_skill_bindings (
                    workspace_id TEXT NOT NULL,
                    skill_id TEXT NOT NULL,
                    PRIMARY KEY (workspace_id, skill_id),
                    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
                    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
                );
                INSERT INTO skills (id, name, directory) VALUES
                    ('skill-a', 'Skill A', 'skill-a'),
                    ('skill-b', 'Skill B', 'skill-b');
                INSERT INTO workspaces (id, name, path) VALUES ('ws-a', 'Workspace A', '/tmp/ws-a');
                INSERT INTO skill_groups (id, name) VALUES ('group-a', 'Group A');
                INSERT INTO skill_group_members (group_id, skill_id) VALUES
                    ('group-a', 'skill-a'),
                    ('group-a', 'skill-b');
                INSERT INTO workspace_group_active (workspace_id, group_id) VALUES ('ws-a', 'group-a');
                INSERT INTO workspace_skill_bindings (workspace_id, skill_id) VALUES ('ws-a', 'skill-a');
                "#,
            )
            .expect("seed bindings");
        }

        let bindings =
            WorkspaceSkillService::get_bindings(&db, "ws-a").expect("read workspace bindings");

        assert_eq!(bindings.group_ids, vec!["group-a".to_string()]);
        assert_eq!(bindings.skill_ids, vec!["skill-a".to_string()]);
        assert_eq!(bindings.total_skill_count, 2);
    }

    #[test]
    fn user_level_bindings_follow_global_group_state_and_keep_direct_skill() {
        let db = Arc::new(Database::memory().expect("create memory db"));
        {
            let conn = db.conn.lock().expect("lock conn");
            conn.execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS workspace_skill_bindings (
                    workspace_id TEXT NOT NULL,
                    skill_id TEXT NOT NULL,
                    PRIMARY KEY (workspace_id, skill_id),
                    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
                    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
                );
                INSERT OR IGNORE INTO workspaces (id, name, path) VALUES ('user', '全局', '~');
                INSERT INTO skills (id, name, directory) VALUES
                    ('skill-direct', 'Direct', 'direct'),
                    ('skill-group', 'Grouped', 'grouped');
                INSERT INTO skill_groups (id, name, is_active)
                    VALUES ('group-global', 'Global', 1);
                INSERT INTO skill_group_members (group_id, skill_id)
                    VALUES ('group-global', 'skill-group');
                INSERT INTO workspace_skill_bindings (workspace_id, skill_id)
                    VALUES ('user', 'skill-direct');
                "#,
            )
            .expect("seed global bindings");
        }

        let active =
            WorkspaceSkillService::get_bindings(&db, "user").expect("read active global bindings");
        assert_eq!(active.group_ids, vec!["group-global".to_string()]);
        assert_eq!(active.skill_ids, vec!["skill-direct".to_string()]);
        assert_eq!(active.total_skill_count, 2);

        db.toggle_workspace_group_active("user", "group-global", false)
            .expect("disable global group through workspace state API");
        let inactive = WorkspaceSkillService::get_bindings(&db, "user")
            .expect("read bindings after group switch");
        assert!(inactive.group_ids.is_empty());
        assert_eq!(inactive.skill_ids, vec!["skill-direct".to_string()]);
        assert_eq!(inactive.total_skill_count, 1);
    }

    #[test]
    fn global_sync_selection_is_active_group_union_direct_and_keeps_direct_after_switch() {
        let db = Arc::new(Database::memory().expect("create memory db"));
        {
            let conn = db.conn.lock().expect("lock conn");
            conn.execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS workspace_skill_bindings (
                    workspace_id TEXT NOT NULL,
                    skill_id TEXT NOT NULL,
                    PRIMARY KEY (workspace_id, skill_id),
                    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
                    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
                );
                INSERT OR IGNORE INTO workspaces (id, name, path) VALUES ('user', '全局', '~');
                INSERT INTO skills (id, name, directory) VALUES
                    ('skill-direct', 'Direct', 'direct'),
                    ('skill-group', 'Grouped', 'grouped');
                INSERT INTO skill_groups (id, name, is_active)
                    VALUES ('group-global', 'Global', 1);
                INSERT INTO skill_group_members (group_id, skill_id)
                    VALUES ('group-global', 'skill-group');
                INSERT INTO workspace_skill_bindings (workspace_id, skill_id)
                    VALUES ('user', 'skill-direct');
                "#,
            )
            .expect("seed global sync selection");
        }

        assert_eq!(
            WorkspaceSkillService::collect_global_skill_ids(&db)
                .expect("collect active global selection"),
            HashSet::from(["skill-direct".to_string(), "skill-group".to_string()])
        );

        db.toggle_workspace_group_active("user", "group-global", false)
            .expect("disable global group");
        assert_eq!(
            WorkspaceSkillService::collect_global_skill_ids(&db)
                .expect("collect selection after group switch"),
            HashSet::from(["skill-direct".to_string()])
        );
    }

    #[test]
    #[serial_test::serial]
    fn user_level_sync_never_uses_project_path_branch() {
        let db = Arc::new(Database::memory().expect("create memory db"));
        let path_that_is_a_file = NamedTempFile::new().expect("create sentinel file");
        {
            let conn = db.conn.lock().expect("lock conn");
            conn.execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS workspace_skill_bindings (
                    workspace_id TEXT NOT NULL,
                    skill_id TEXT NOT NULL,
                    PRIMARY KEY (workspace_id, skill_id),
                    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
                    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
                );
                INSERT OR IGNORE INTO workspaces (id, name, path) VALUES ('user', '全局', '~');
                "#,
            )
            .expect("seed global workspace");
            conn.execute(
                "UPDATE workspaces SET path = ?1 WHERE id = 'user'",
                [path_that_is_a_file.path().to_string_lossy().as_ref()],
            )
            .expect("replace global path with project-branch sentinel");
        }

        WorkspaceSkillService::sync_active_groups_to_workspace(&db, "user")
            .expect("user-level sync must branch before joining the workspace path");
    }
}
