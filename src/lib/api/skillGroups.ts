import { invoke } from "@tauri-apps/api/core";
import type { SkillGroup, SkillGroupApps } from "@/lib/api/skills";

export const DEFAULT_GROUP_APPS: SkillGroupApps = {
  claude: true,
  codex: false,
  gemini: false,
  opencode: false,
  hermes: false,
};

export const skillGroupsApi = {
  getAll: (): Promise<SkillGroup[]> => invoke("get_skill_groups"),

  create: (params: {
    name: string;
    description?: string;
    apps: SkillGroupApps;
  }): Promise<SkillGroup> =>
    invoke("create_skill_group", {
      name: params.name,
      description: params.description ?? null,
      apps: params.apps,
    }),

  update: (params: {
    id: string;
    name: string;
    description?: string;
    apps: SkillGroupApps;
  }): Promise<SkillGroup> =>
    invoke("update_skill_group", {
      id: params.id,
      name: params.name,
      description: params.description ?? null,
      apps: params.apps,
    }),

  delete: (id: string): Promise<void> => invoke("delete_skill_group", { id }),

  activate: (id: string): Promise<void> =>
    invoke("activate_skill_group", { id }),

  deactivateAll: (): Promise<void> => invoke("deactivate_all_skill_groups"),

  addSkill: (groupId: string, skillId: string): Promise<void> =>
    invoke("add_skill_to_group", { groupId, skillId }),

  removeSkill: (groupId: string, skillId: string): Promise<void> =>
    invoke("remove_skill_from_group", { groupId, skillId }),

  getMemberIds: (groupId: string): Promise<string[]> =>
    invoke("get_group_member_ids", { groupId }),
};
