import { invoke } from "@tauri-apps/api/core";

export interface Workspace {
  id: string;
  name: string;
  path: string;
  isUserLevel: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceBindings {
  groupIds: string[];
  skillIds: string[];
  totalSkillCount: number;
}

export const workspacesApi = {
  getAll: (): Promise<Workspace[]> => invoke("get_workspaces"),

  create: (params: { name: string; path: string }): Promise<Workspace> =>
    invoke("create_workspace", params),

  update: (params: { id: string; name: string; path: string }): Promise<Workspace> =>
    invoke("update_workspace", params),

  delete: (id: string): Promise<void> => invoke("delete_workspace", { id }),

  getBindings: (workspaceId: string): Promise<WorkspaceBindings> =>
    invoke("get_workspace_bindings", { workspaceId }),

  toggleGroup: (workspaceId: string, groupId: string, active: boolean): Promise<void> =>
    invoke("toggle_workspace_group", { workspaceId, groupId, active }),

  toggleSkill: (workspaceId: string, skillId: string, active: boolean): Promise<void> =>
    invoke("toggle_workspace_skill", { workspaceId, skillId, active }),
};
