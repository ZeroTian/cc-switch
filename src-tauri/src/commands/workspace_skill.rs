//! 工作空间命令层

use crate::database::dao::workspaces::Workspace;
use crate::services::workspace_skill::WorkspaceSkillService;
use crate::store::AppState;
use chrono::Utc;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub fn get_workspaces(app_state: State<'_, AppState>) -> Result<Vec<Workspace>, String> {
    app_state.db.get_all_workspaces().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_workspace(
    name: String,
    path: String,
    app_state: State<'_, AppState>,
) -> Result<Workspace, String> {
    let now = Utc::now().timestamp();
    let ws = Workspace {
        id: Uuid::new_v4().to_string(),
        name,
        path,
        is_user_level: false,
        created_at: now,
        updated_at: now,
        group_ids: vec![],
    };
    app_state.db.create_workspace(&ws).map_err(|e| e.to_string())?;
    Ok(ws)
}

#[tauri::command]
pub fn update_workspace(
    id: String,
    name: String,
    path: String,
    app_state: State<'_, AppState>,
) -> Result<Workspace, String> {
    let mut ws = app_state
        .db
        .get_workspace(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("工作空间不存在: {id}"))?;
    ws.name = name;
    ws.path = path;
    ws.updated_at = Utc::now().timestamp();
    app_state.db.update_workspace(&ws).map_err(|e| e.to_string())?;
    Ok(ws)
}

#[tauri::command]
pub fn delete_workspace(id: String, app_state: State<'_, AppState>) -> Result<(), String> {
    app_state.db.delete_workspace(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_group_to_workspace(
    workspace_id: String,
    group_id: String,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    app_state
        .db
        .add_group_to_workspace(&workspace_id, &group_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_group_from_workspace(
    workspace_id: String,
    group_id: String,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    app_state
        .db
        .remove_group_from_workspace(&workspace_id, &group_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_workspace_group_ids(
    workspace_id: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    app_state
        .db
        .get_workspace_group_ids(&workspace_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_group_in_workspace(
    workspace_id: String,
    group_id: String,
    active: bool,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    WorkspaceSkillService::toggle_group(&app_state.db, &workspace_id, &group_id, active)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_workspace_active_group_ids(
    workspace_id: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    app_state
        .db
        .get_workspace_active_group_ids(&workspace_id)
        .map_err(|e| e.to_string())
}
