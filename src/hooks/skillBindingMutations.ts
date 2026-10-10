import type { QueryClient } from "@tanstack/react-query";

const mutationKey = ["skillBindings"];

// These writes can touch the same skill directories. Queue disk operations,
// but let every selection update the cache immediately, including queued ones.
export function skillBindingMutationOptions(client: QueryClient) {
  return {
    mutationKey,
    scope: { id: "skill-bindings" },
    onSettled: () => {
      // A mid-queue readback would overwrite selections not yet saved.
      if (client.isMutating({ mutationKey }) !== 1) return;
      return Promise.all([
        client.invalidateQueries({ queryKey: ["skillGroups"] }),
        client.invalidateQueries({ queryKey: ["workspaces", "activeGroups"] }),
        client.invalidateQueries({ queryKey: ["workspaces", "bindings"] }),
      ]);
    },
  };
}

export function updateSelectedId(ids: string[], id: string, selected: boolean) {
  return selected
    ? ids.includes(id)
      ? ids
      : [...ids, id]
    : ids.filter((existing) => existing !== id);
}
