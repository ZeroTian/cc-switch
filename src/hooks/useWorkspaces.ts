import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workspacesApi } from "@/lib/api/workspaces";

export function useWorkspaces() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: () => workspacesApi.getAll(),
    staleTime: Infinity,
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: workspacesApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

export function useUpdateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: workspacesApi.update,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workspacesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

export function useWorkspaceBindings(workspaceId: string | null) {
  return useQuery({
    queryKey: ["workspaces", "bindings", workspaceId],
    queryFn: () => workspacesApi.getBindings(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 0,
  });
}

export function useToggleWorkspaceGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, groupId, active }: { workspaceId: string; groupId: string; active: boolean }) =>
      workspacesApi.toggleGroup(workspaceId, groupId, active),
    onSuccess: (_data, { workspaceId }) => {
      qc.invalidateQueries({ queryKey: ["workspaces", "bindings", workspaceId] });
      qc.invalidateQueries({ queryKey: ["skills", "installed"] });
    },
  });
}

export function useToggleWorkspaceSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, skillId, active }: { workspaceId: string; skillId: string; active: boolean }) =>
      workspacesApi.toggleSkill(workspaceId, skillId, active),
    onSuccess: (_data, { workspaceId }) => {
      qc.invalidateQueries({ queryKey: ["workspaces", "bindings", workspaceId] });
      qc.invalidateQueries({ queryKey: ["skills", "installed"] });
    },
  });
}
