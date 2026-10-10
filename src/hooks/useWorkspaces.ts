import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { workspacesApi, type WorkspaceBindings } from "@/lib/api/workspaces";
import type { SkillGroup } from "@/lib/api/skills";
import {
  skillBindingMutationOptions,
  updateSelectedId,
} from "./skillBindingMutations";

function updateBindings(
  client: QueryClient,
  workspaceId: string,
  field: "groupIds" | "skillIds",
  id: string,
  selected: boolean,
) {
  client.setQueryData<WorkspaceBindings>(
    ["workspaces", "bindings", workspaceId],
    (previous) => {
      if (!previous) return previous;
      const bindings = {
        ...previous,
        [field]: updateSelectedId(previous[field], id, selected),
      };
      const groups = client.getQueryData<SkillGroup[]>(["skillGroups"]);
      if (
        !groups ||
        bindings.groupIds.some(
          (groupId) => !groups.some((group) => group.id === groupId),
        )
      ) {
        return bindings;
      }
      const allSkillIds = new Set(bindings.skillIds);
      for (const groupId of bindings.groupIds) {
        const memberIds =
          client.getQueryData<string[]>(["skillGroups", "members", groupId]) ??
          groups.find((group) => group.id === groupId)!.memberIds;
        memberIds.forEach((skillId) => allSkillIds.add(skillId));
      }
      return { ...bindings, totalSkillCount: allSkillIds.size };
    },
  );
}

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
    ...skillBindingMutationOptions(qc),
    mutationFn: ({
      workspaceId,
      groupId,
      active,
    }: {
      workspaceId: string;
      groupId: string;
      active: boolean;
    }) => workspacesApi.toggleGroupActive(workspaceId, groupId, active),
    onMutate: async ({ workspaceId, groupId, active }) => {
      const key = ["workspaces", "activeGroups", workspaceId];
      await Promise.all([
        qc.cancelQueries({ queryKey: key }),
        qc.cancelQueries({ queryKey: ["workspaces", "bindings", workspaceId] }),
      ]);
      const wasSelected =
        qc.getQueryData<string[]>(key)?.includes(groupId) ?? false;
      qc.setQueryData<string[]>(key, (ids = []) =>
        updateSelectedId(ids, groupId, active),
      );
      updateBindings(qc, workspaceId, "groupIds", groupId, active);
      return { wasSelected };
    },
    onError: (_error, { workspaceId, groupId }, context) => {
      if (!context) return;
      qc.setQueryData<string[]>(
        ["workspaces", "activeGroups", workspaceId],
        (ids = []) => updateSelectedId(ids, groupId, context.wasSelected),
      );
      updateBindings(qc, workspaceId, "groupIds", groupId, context.wasSelected);
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

export function useWorkspaceBindings(workspaceId: string | null) {
  return useQuery({
    queryKey: ["workspaces", "bindings", workspaceId],
    queryFn: () => workspacesApi.getBindings(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 0,
  });
}

export function useToggleWorkspaceSkill() {
  const qc = useQueryClient();
  return useMutation({
    ...skillBindingMutationOptions(qc),
    mutationFn: ({
      workspaceId,
      skillId,
      active,
    }: {
      workspaceId: string;
      skillId: string;
      active: boolean;
    }) => workspacesApi.toggleSkill(workspaceId, skillId, active),
    onMutate: async ({ workspaceId, skillId, active }) => {
      const key = ["workspaces", "bindings", workspaceId];
      await qc.cancelQueries({ queryKey: key });
      const wasSelected =
        qc.getQueryData<WorkspaceBindings>(key)?.skillIds.includes(skillId) ??
        false;
      updateBindings(qc, workspaceId, "skillIds", skillId, active);
      return { wasSelected };
    },
    onError: (_error, { workspaceId, skillId }, context) => {
      if (!context) return;
      updateBindings(qc, workspaceId, "skillIds", skillId, context.wasSelected);
    },
  });
}
