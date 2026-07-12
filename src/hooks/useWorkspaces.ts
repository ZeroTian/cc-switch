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

export function useAddGroupToWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      groupId,
    }: {
      workspaceId: string;
      groupId: string;
    }) => workspacesApi.addGroup(workspaceId, groupId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

export function useRemoveGroupFromWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      groupId,
    }: {
      workspaceId: string;
      groupId: string;
    }) => workspacesApi.removeGroup(workspaceId, groupId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

export function useToggleGroupInWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      groupId,
      active,
    }: {
      workspaceId: string;
      groupId: string;
      active: boolean;
    }) => workspacesApi.toggleGroupActive(workspaceId, groupId, active),
    onSuccess: (_data, { workspaceId }) => {
      qc.invalidateQueries({
        queryKey: ["workspaces", "activeGroups", workspaceId],
      });
    },
  });
}

export function useWorkspaceActiveGroupIds(workspaceId: string | null) {
  return useQuery({
    queryKey: ["workspaces", "activeGroups", workspaceId],
    queryFn: () => workspacesApi.getActiveGroupIds(workspaceId!),
    enabled: !!workspaceId,
    staleTime: Infinity,
  });
}
