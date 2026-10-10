import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { skillGroupsApi } from "@/lib/api/skillGroups";
import {
  skillBindingMutationOptions,
  updateSelectedId,
} from "./skillBindingMutations";

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
    ...skillBindingMutationOptions(qc),
    mutationFn: skillGroupsApi.create,
  });
}

export function useUpdateSkillGroup() {
  const qc = useQueryClient();
  return useMutation({
    ...skillBindingMutationOptions(qc),
    mutationFn: skillGroupsApi.update,
  });
}

export function useDeleteSkillGroup() {
  const qc = useQueryClient();
  return useMutation({
    ...skillBindingMutationOptions(qc),
    mutationFn: (id: string) => skillGroupsApi.delete(id),
  });
}

export function useSetGroupActive() {
  const qc = useQueryClient();
  return useMutation({
    ...skillBindingMutationOptions(qc),
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      skillGroupsApi.setActive(id, active),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills", "installed"] });
    },
  });
}

export function useAddSkillToGroup() {
  return useChangeSkillGroupMember(true);
}

export function useRemoveSkillFromGroup() {
  return useChangeSkillGroupMember(false);
}

function useChangeSkillGroupMember(selected: boolean) {
  const qc = useQueryClient();
  return useMutation({
    ...skillBindingMutationOptions(qc),
    mutationFn: ({ groupId, skillId }: { groupId: string; skillId: string }) =>
      selected
        ? skillGroupsApi.addSkill(groupId, skillId)
        : skillGroupsApi.removeSkill(groupId, skillId),
    onMutate: async ({ groupId, skillId }) => {
      const key = ["skillGroups", "members", groupId];
      await qc.cancelQueries({ queryKey: key });
      const wasSelected =
        qc.getQueryData<string[]>(key)?.includes(skillId) ?? false;
      qc.setQueryData<string[]>(key, (ids = []) =>
        updateSelectedId(ids, skillId, selected),
      );
      return { wasSelected };
    },
    onError: (_error, { groupId, skillId }, context) => {
      if (!context) return;
      qc.setQueryData<string[]>(
        ["skillGroups", "members", groupId],
        (ids = []) => updateSelectedId(ids, skillId, context.wasSelected),
      );
    },
  });
}
