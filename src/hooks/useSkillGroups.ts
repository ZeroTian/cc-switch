import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { skillGroupsApi } from "@/lib/api/skillGroups";
import type { SkillGroup } from "@/lib/api/skills";

export function useSkillGroups() {
  return useQuery({
    queryKey: ["skillGroups"],
    queryFn: () => skillGroupsApi.getAll(),
    staleTime: Infinity,
  });
}

export function useGroupMemberIds(groupId: string | null) {
  return useQuery({
    queryKey: ["skillGroups", "members", groupId],
    queryFn: () => skillGroupsApi.getMemberIds(groupId!),
    enabled: !!groupId,
    staleTime: Infinity,
  });
}


export function useCreateSkillGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: skillGroupsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skillGroups"] }),
  });
}

export function useUpdateSkillGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: skillGroupsApi.update,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skillGroups"] }),
  });
}

export function useDeleteSkillGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => skillGroupsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skillGroups"] }),
  });
}

export function useSetGroupActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      skillGroupsApi.setActive(id, active),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skillGroups"] });
      qc.invalidateQueries({ queryKey: ["skills", "installed"] });
    },
  });
}

export function useAddSkillToGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, skillId }: { groupId: string; skillId: string }) =>
      skillGroupsApi.addSkill(groupId, skillId),
    onSuccess: (_data, { groupId }) => {
      qc.invalidateQueries({ queryKey: ["skillGroups"] });
      qc.invalidateQueries({ queryKey: ["skillGroups", "members", groupId] });
    },
  });
}

export function useRemoveSkillFromGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, skillId }: { groupId: string; skillId: string }) =>
      skillGroupsApi.removeSkill(groupId, skillId),
    onSuccess: (_data, { groupId }) => {
      qc.invalidateQueries({ queryKey: ["skillGroups"] });
      qc.invalidateQueries({ queryKey: ["skillGroups", "members", groupId] });
    },
  });
}
