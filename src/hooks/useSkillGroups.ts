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
