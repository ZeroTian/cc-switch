import { invoke } from "@tauri-apps/api/core";
import type { SkillGroup } from "@/lib/api/skills";

export const skillGroupsApi = {
  getAll: (): Promise<SkillGroup[]> => invoke("get_skill_groups"),

  create: (params: {
    name: string;
    description?: string;
  }): Promise<SkillGroup> =>
    invoke("create_skill_group", {
      name: params.name,
      description: params.description ?? null,
    }),

  update: (params: {
    id: string;
    name: string;
    description?: string;
    memberIds: string[];
  }): Promise<SkillGroup> =>
    invoke("update_skill_group", {
      id: params.id,
      name: params.name,
      description: params.description ?? null,
      memberIds: params.memberIds,
    }),

  delete: (id: string): Promise<void> => invoke("delete_skill_group", { id }),

  getMemberIds: (groupId: string): Promise<string[]> =>
    invoke("get_group_member_ids", { groupId }),
};
