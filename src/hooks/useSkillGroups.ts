import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { skillGroupsApi } from "@/lib/api/skillGroups";

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skillGroups"] });
      qc.invalidateQueries({ queryKey: ["skills", "installed"] });
      qc.invalidateQueries({ queryKey: ["workspaces", "bindings"] });
    },
  });
}

export function useReorderSkillGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) => skillGroupsApi.reorder(orderedIds),
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey: ["skillGroups"] });
      const previous = qc.getQueryData(["skillGroups"]);
      qc.setQueryData(["skillGroups"], (old: import("@/lib/api/skills").SkillGroup[] | undefined) => {
        if (!old) return old;
        return orderedIds.map((id) => old.find((g) => g.id === id)!).filter(Boolean);
      });
      return { previous };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.previous) qc.setQueryData(["skillGroups"], ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["skillGroups"] }),
  });
}

export function useDeleteSkillGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => skillGroupsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skillGroups"] });
      qc.invalidateQueries({ queryKey: ["workspaces", "bindings"] });
    },
  });
}
