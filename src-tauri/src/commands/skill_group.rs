//! 技能分组命令层

use crate::database::dao::skill_groups::SkillGroup;
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
    app_state: State<'_, AppState>,
) -> Result<SkillGroup, String> {
    SkillGroupService::create(&app_state.db, name, description).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_skill_group(
    id: String,
    name: String,
    description: Option<String>,
    member_ids: Vec<String>,
    app_state: State<'_, AppState>,
) -> Result<SkillGroup, String> {
    SkillGroupService::update(&app_state.db, &id, name, description, member_ids)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_skill_group(id: String, app_state: State<'_, AppState>) -> Result<(), String> {
    // 先同步受影响的工作空间，再删除（删除后 FK CASCADE 会清除 binding 行，无法再查）
    if let Err(e) = WorkspaceSkillService::sync_workspaces_for_group(&app_state.db, &id) {
        log::warn!("delete_skill_group: pre-delete sync failed: {e}");
    }
    app_state.db.delete_skill_group(&id).map_err(|e| e.to_string())
}

/// 批量更新分组排序（传入有序 id 列表，按下标写入 sort_index）
#[tauri::command]
pub fn reorder_skill_groups(
    ordered_ids: Vec<String>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    app_state
        .db
        .reorder_skill_groups(&ordered_ids)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_group_member_ids(
    group_id: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    app_state.db.get_group_member_ids(&group_id).map_err(|e| e.to_string())
}
