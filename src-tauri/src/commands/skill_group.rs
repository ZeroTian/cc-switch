//! 技能分组命令层

use crate::database::dao::skill_groups::{SkillGroup, SkillGroupApps};
use crate::services::skill_group::SkillGroupService;
use crate::services::workspace_skill::WorkspaceSkillService;
use crate::store::AppState;
use tauri::State;

#[tauri::command]
pub fn get_skill_groups(app_state: State<'_, AppState>) -> Result<Vec<SkillGroup>, String> {
    app_state.db.get_all_skill_groups().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_skill_group(
    name: String,
    description: Option<String>,
    apps: SkillGroupApps,
    app_state: State<'_, AppState>,
) -> Result<SkillGroup, String> {
    SkillGroupService::create(&app_state.db, name, description, apps).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_skill_group(
    id: String,
    name: String,
    description: Option<String>,
    apps: SkillGroupApps,
    app_state: State<'_, AppState>,
) -> Result<SkillGroup, String> {
    SkillGroupService::update(&app_state.db, &id, name, description, apps)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_skill_group(id: String, app_state: State<'_, AppState>) -> Result<(), String> {
    app_state.db.delete_skill_group(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_group_active(
    id: String,
    active: bool,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    SkillGroupService::set_active(&app_state.db, &id, active).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_skill_to_group(
    group_id: String,
    skill_id: String,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    app_state
        .db
        .add_skill_to_group(&group_id, &skill_id)
        .map_err(|e| e.to_string())?;
    // 重新同步全局（sync 内部自行计算所有激活分组）
    if let Err(e) = SkillGroupService::sync_active_groups_to_global(&app_state.db) {
        log::warn!("skill_to_group: 全局同步失败: {e}");
    }
    // 同步到绑定该分组的工作空间
    if let Err(e) = WorkspaceSkillService::sync_workspaces_for_group(&app_state.db, &group_id) {
        log::warn!("skill_to_group: 工作空间同步失败: {e}");
    }
    Ok(())
}

#[tauri::command]
pub fn remove_skill_from_group(
    group_id: String,
    skill_id: String,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    app_state
        .db
        .remove_skill_from_group(&group_id, &skill_id)
        .map_err(|e| e.to_string())?;
    // 重新同步全局（sync 内部自行计算所有激活分组）
    if let Err(e) = SkillGroupService::sync_active_groups_to_global(&app_state.db) {
        log::warn!("skill_to_group: 全局同步失败: {e}");
    }
    // 同步到绑定该分组的工作空间
    if let Err(e) = WorkspaceSkillService::sync_workspaces_for_group(&app_state.db, &group_id) {
        log::warn!("skill_to_group: 工作空间同步失败: {e}");
    }
    Ok(())
}

#[tauri::command]
pub fn get_group_member_ids(
    group_id: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    app_state
        .db
        .get_group_member_ids(&group_id)
        .map_err(|e| e.to_string())
}
