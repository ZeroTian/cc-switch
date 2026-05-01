//! 工作空间命令层

use crate::database::dao::workspaces::Workspace;
use crate::services::workspace_skill::{WorkspaceBindings, WorkspaceSkillService};
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
    if path.trim() == "~" {
        return Err("路径不能为 ~（保留给用户级别空间）".to_string());
    }
    let now = Utc::now().timestamp();
    let ws = Workspace {
        id: Uuid::new_v4().to_string(),
        name,
        path,
        is_user_level: false,
        created_at: now,
        updated_at: now,
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
    // 用户级别空间：path 由数据库维护，忽略调用方传入的值
    if !ws.is_user_level {
        ws.path = path;
    }
    ws.updated_at = Utc::now().timestamp();
    app_state.db.update_workspace(&ws).map_err(|e| e.to_string())?;
    Ok(ws)
}

#[tauri::command]
pub fn delete_workspace(id: String, app_state: State<'_, AppState>) -> Result<(), String> {
    if let Ok(Some(ws)) = app_state.db.get_workspace(&id) {
        if ws.is_user_level {
            return Err("用户级别空间不可删除".to_string());
        }
    }
    app_state.db.delete_workspace(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_workspace_bindings(
    workspace_id: String,
    app_state: State<'_, AppState>,
) -> Result<WorkspaceBindings, String> {
    WorkspaceSkillService::get_bindings(&app_state.db, &workspace_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_workspace_group(
    workspace_id: String,
    group_id: String,
    active: bool,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    WorkspaceSkillService::toggle_group(&app_state.db, &workspace_id, &group_id, active)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_workspace_skill(
    workspace_id: String,
    skill_id: String,
    active: bool,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    WorkspaceSkillService::toggle_skill(&app_state.db, &workspace_id, &skill_id, active)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_workspaces(
    ordered_ids: Vec<String>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    app_state.db.reorder_workspaces(&ordered_ids).map_err(|e| e.to_string())
}

