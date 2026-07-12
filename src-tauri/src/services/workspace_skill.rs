//! WorkspaceSkill 业务逻辑层

use crate::database::Database;
use crate::services::skill::SkillService;
use anyhow::{anyhow, Result};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// 技能目录清单文件名，记录由 cc-switch 管理的 skill 目录列表。
/// 位于 `.claude/skills/` 下，JSON 字符串数组格式。
const MANAGED_MANIFEST_FILENAME: &str = ".cc-switch-managed.json";

/// 所有权标记文件名。copy fallback 部署时在目标目录内写入该空文件，
/// bootstrap 通过检测该标记确认目录归属，避免误判用户自建同名目录。
const MANAGED_MARKER: &str = ".cc-switch-managed";

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
    ///
    /// 仅操作由 cc-switch 管理的条目（通过清单文件追踪），
    /// 不会误删用户手动放置或其他工具管理的文件/目录。
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

        let ssot_dir = SkillService::get_ssot_dir()?;

        // 读取上次同步时记录的清单，得知哪些条目是本功能管理的。
        // 读取失败（如 JSON 损坏）时传播错误以跳过本轮 sync，避免覆盖旧清单丢失追踪信息。
        let mut old_managed = Self::read_skills_manifest(&target_skills_dir)
            .map_err(|e| anyhow!("读取 skills 清单失败，跳过本轮同步以保留旧清单: {e}"))?;

        // 引导：仅当 manifest 文件不存在时（首次 sync 或新升级）扫描已有管理条目。
        // 文件存在但内容为空（[]）表示已 bootstrap 过且无条目，不应重入。
        let manifest_path = Self::manifest_path(&target_skills_dir);
        if !manifest_path.exists() {
            let bootstrapped = Self::bootstrap_managed_entries(&target_skills_dir, &ssot_dir);
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
        let recovered = Self::recover_orphaned_managed(&target_skills_dir, &old_managed, &ssot_dir);
        if !recovered.is_empty() {
            log::info!(
                "sync_workspace: 恢复 {} 个孤儿管理条目（磁盘存在但清单未记录）",
                recovered.len()
            );
            old_managed.extend(recovered);
        }

        // 本次将管理的 skill 目录名集合
        let mut new_managed: HashSet<String> = HashSet::new();

        for skill_id in &skill_ids {
            match db.get_installed_skill(skill_id) {
                Ok(Some(skill)) => {
                    let source = ssot_dir.join(&skill.directory);
                    if !source.exists() {
                        log::warn!("sync_workspace: SSOT skill {} 不存在", skill.name);
                        continue;
                    }
                    let dest = target_skills_dir.join(&skill.directory);

                    // 仅当目标已由我们管理（在旧清单中）且文件系统仍归我们所有时，
                    // 才移除旧条目。用户可能在清单记录后手动替换了部署内容。
                    if old_managed.contains(&skill.directory) {
                        if dest.exists() || dest.is_symlink() {
                            if Self::is_still_managed(&dest, &ssot_dir) {
                                let _ = std::fs::remove_dir_all(&dest);
                            } else {
                                log::warn!(
                                    "sync_workspace: skill {} 条目已被用户替换，跳过删除",
                                    skill.name
                                );
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
                    if deployed {
                        new_managed.insert(skill.directory.clone());
                    }
                }
                Ok(None) => log::warn!("sync_workspace: skill {skill_id} 不存在"),
                Err(e) => log::warn!("sync_workspace: 读取 skill {skill_id} 失败: {e}"),
            }
        }

        // 清理旧清单中本次不再激活的条目（仅移除我们管理的，不动其他文件）
        let cleanup_failed =
            Self::cleanup_stale_entries(&target_skills_dir, &old_managed, &new_managed, &ssot_dir);
        // 删除失败（如锁占用）的条目保留在 manifest 中，下次 sync 重试
        if !cleanup_failed.is_empty() {
            log::warn!(
                "sync_workspace: {} 个条目清理失败，保留在清单中等待下次重试",
                cleanup_failed.len()
            );
            new_managed.extend(cleanup_failed);
        }

        // 持久化本次清单。写入失败时整个 sync 返回错误，
        // 避免新部署的条目在下次 sync 因清单缺失而丢失追踪。
        Self::write_skills_manifest(&target_skills_dir, &new_managed)
            .map_err(|e| anyhow!("写入 skills 清单失败，本轮同步未持久化: {e}"))?;

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

    /// 当技能的应用启用状态变化时，同步所有包含该技能的分组所影响的工作空间。
    pub fn sync_workspaces_for_skill(db: &Arc<Database>, skill_id: &str) -> Result<()> {
        let groups = db.get_all_skill_groups().map_err(|e| anyhow!("{e}"))?;
        for group in groups
            .iter()
            .filter(|group| group.member_ids.iter().any(|id| id == skill_id))
        {
            Self::sync_workspaces_for_group(db, &group.id)?;
        }
        Ok(())
    }

    // ─── 部署逻辑 ──────────────────────────────────────────────────

    /// 将 source 部署到 dest（优先 symlink，fallback 复制）。
    /// 返回是否部署成功。
    fn deploy_skill(
        source: &Path,
        dest: &Path,
        dir_name: &str,
        skill_name: &str,
        old_managed: &HashSet<String>,
    ) -> bool {
        match Self::create_symlink(source, dest) {
            Ok(()) => true,
            Err(e) => {
                log::warn!("sync_workspace: symlink {} 失败: {e}", skill_name);

                if old_managed.contains(dir_name) {
                    // 调用者已在上方验证所有权并删除旧条目，
                    // 此处直接 copy 重建即可，无需重复 remove_dir_all。
                    match Self::copy_dir_and_mark(source, dest) {
                        Ok(()) => true,
                        Err(e2) => {
                            log::warn!("sync_workspace: copy {} 失败: {e2}", skill_name);
                            false
                        }
                    }
                } else if dest.exists() {
                    // 目标存在但不是我们管理的 → 不触碰
                    log::warn!(
                        "sync_workspace: skill {} 的目录已存在且非本工具管理，跳过",
                        skill_name
                    );
                    false
                } else {
                    // 目标不存在（全新部署且 symlink 不可用）→ 走复制 fallback
                    log::info!(
                        "sync_workspace: symlink 不受支持，使用复制方式部署 {}",
                        skill_name
                    );
                    match Self::copy_dir_and_mark(source, dest) {
                        Ok(()) => true,
                        Err(e2) => {
                            log::warn!("sync_workspace: copy {} 失败: {e2}", skill_name);
                            false
                        }
                    }
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
    fn bootstrap_managed_entries(skills_dir: &Path, ssot_dir: &Path) -> HashSet<String> {
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
                std::fs::read_link(&path)
                    .map(|target| target.starts_with(ssot_dir))
                    .unwrap_or(false)
            } else if path.is_dir() {
                if path.join(MANAGED_MARKER).exists() {
                    // 新版 copy 部署：有所有权标记
                    true
                } else {
                    // 遗留 copy 部署（无标记）：需要更强的所有权验证。
                    // 仅当候选目录的所有顶层文件都存在于 SSOT 同名目录中时，
                    // 才认定为我们部署的（内容一致 = 我们写的，有额外文件 = 用户改过的）。
                    let ssot_source = ssot_dir.join(&name);
                    ssot_source.is_dir() && Self::is_subset_of_ssot(&path, &ssot_source)
                }
            } else {
                false
            };

            if is_managed {
                // 对无标记的遗留目录补写标记，完成一次性迁移
                if path.is_dir() && !path.join(MANAGED_MARKER).exists() {
                    log::info!("sync_workspace: 为遗留 copy 部署 {} 补写所有权标记", name);
                    let _ = std::fs::write(path.join(MANAGED_MARKER), "");
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
                std::fs::read_link(&path)
                    .map(|target| target.starts_with(ssot_dir))
                    .unwrap_or(false)
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
            std::fs::read_link(entry_path)
                .map(|target| target.starts_with(ssot_dir))
                .unwrap_or(false)
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
    /// 返回删除失败的条目集合，调用者应将这些条目保留在 manifest 中等待下次重试。
    fn cleanup_stale_entries(
        skills_dir: &Path,
        old_managed: &HashSet<String>,
        new_managed: &HashSet<String>,
        ssot_dir: &Path,
    ) -> HashSet<String> {
        let mut failed = HashSet::new();
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
                if !Self::is_still_managed(&entry_path, ssot_dir) {
                    log::warn!("sync_workspace: 条目 {} 已被用户替换，跳过删除", dir_name);
                    continue;
                }
                log::info!(
                    "sync_workspace: 移除已取消激活的 skill 目录 {}",
                    entry_path.display()
                );
                if let Err(e) = std::fs::remove_dir_all(&entry_path) {
                    log::warn!(
                        "sync_workspace: 移除目录失败 ({}): {e}",
                        entry_path.display()
                    );
                    failed.insert(dir_name.clone());
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
