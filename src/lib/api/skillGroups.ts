import { invoke } from "@tauri-apps/api/core";
import type { SkillGroup } from "@/lib/api/skills";

export const skillGroupsApi = {
  getAll: (): Promise<SkillGroup[]> => invoke("get_skill_groups"),

  create: (params: {
    name: string;
    description?: string;
    icon?: string;
  }): Promise<SkillGroup> =>
    invoke("create_skill_group", {
      name: params.name,
      description: params.description ?? null,
      icon: params.icon ?? null,
    }),

  update: (params: {
    id: string;
    name: string;
    description?: string;
    icon?: string;
  }): Promise<SkillGroup> =>
    invoke("update_skill_group", {
      id: params.id,
      name: params.name,
      description: params.description ?? null,
      icon: params.icon ?? null,
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
