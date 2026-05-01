import { invoke } from "@tauri-apps/api/core";

export interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  groupIds: string[];
}

export interface WorkspaceApplyResult {
  synced: number;
  failed: string[];
}

export const workspacesApi = {
  getAll: (): Promise<Workspace[]> => invoke("get_workspaces"),

  create: (params: { name: string; path: string }): Promise<Workspace> =>
    invoke("create_workspace", { name: params.name, path: params.path }),

  update: (params: { id: string; name: string; path: string }): Promise<Workspace> =>
    invoke("update_workspace", { id: params.id, name: params.name, path: params.path }),

  delete: (id: string): Promise<void> => invoke("delete_workspace", { id }),

  addGroup: (workspaceId: string, groupId: string): Promise<void> =>
    invoke("add_group_to_workspace", { workspaceId, groupId }),

  removeGroup: (workspaceId: string, groupId: string): Promise<void> =>
    invoke("remove_group_from_workspace", { workspaceId, groupId }),

  getGroupIds: (workspaceId: string): Promise<string[]> =>
    invoke("get_workspace_group_ids", { workspaceId }),

  apply: (workspaceId: string): Promise<WorkspaceApplyResult> =>
    invoke("apply_workspace", { workspaceId }),
};
