import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Plus,
  Edit2,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { V7ConfirmDialog } from "@/components/mcp/formBits";
import { WorkspaceEditDialog } from "./WorkspaceEditDialog";
import {
  useWorkspaces,
  useCreateWorkspace,
  useUpdateWorkspace,
  useDeleteWorkspace,
  useToggleGroupInWorkspace,
  useWorkspaceActiveGroupIds,
  useWorkspaceBindings,
  useToggleWorkspaceSkill,
} from "@/hooks/useWorkspaces";
import { useSkillGroups } from "@/hooks/useSkillGroups";
import { useInstalledSkills } from "@/hooks/useSkills";
import type { Workspace } from "@/lib/api/workspaces";

function WorkspaceBindingsList({ workspace }: { workspace: Workspace }) {
  const { t } = useTranslation();
  const { data: groups = [] } = useSkillGroups();
  const { data: skills = [] } = useInstalledSkills();
  const { data: activeGroupIds = [] } = useWorkspaceActiveGroupIds(
    workspace.id,
  );
  const { data: bindings } = useWorkspaceBindings(workspace.id);
  const toggleGroupMutation = useToggleGroupInWorkspace();
  const toggleSkillMutation = useToggleWorkspaceSkill();
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);
  const [pendingSkillId, setPendingSkillId] = useState<string | null>(null);
  const orderedGroups = [...groups].sort(
    (a, b) =>
      Number(activeGroupIds.includes(b.id)) -
      Number(activeGroupIds.includes(a.id)),
  );
  const selectedSkillIds = new Set(bindings?.skillIds ?? []);
  const orderedSkills = [...skills].sort(
    (a, b) =>
      Number(selectedSkillIds.has(b.id)) - Number(selectedSkillIds.has(a.id)),
  );

  const handleToggleGroup = async (groupId: string, checked: boolean) => {
    setPendingGroupId(groupId);
    try {
      await toggleGroupMutation.mutateAsync({
        workspaceId: workspace.id,
        groupId,
        active: checked,
      });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), {
        description: String(error),
      });
    } finally {
      setPendingGroupId(null);
    }
  };

  const handleToggleSkill = async (skillId: string, checked: boolean) => {
    setPendingSkillId(skillId);
    try {
      await toggleSkillMutation.mutateAsync({
        workspaceId: workspace.id,
        skillId,
        active: checked,
      });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), {
        description: String(error),
      });
    } finally {
      setPendingSkillId(null);
    }
  };

  if (groups.length === 0 && skills.length === 0) {
    return (
      <div className="px-3 py-3 text-body text-fg-2">
        {t(
          "workspaces.noSkillsOrGroups",
          "还没有分组或 Skill，请先安装 Skill 或创建分组",
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 px-3 py-3">
      <Collapsible defaultOpen className="space-y-0.5">
        <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-control bg-subtle px-2 py-1 text-left text-caption font-medium text-fg-2 hover:text-fg-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
          <ChevronRight
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90"
          />
          {t("workspaces.bindGroups", "分组")}
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-0.5">
          {groups.length === 0 ? (
            <div className="px-2 py-2 text-body text-fg-2">
              {t("workspaces.noGroupsAvailable", "还没有分组")}
            </div>
          ) : (
            orderedGroups.map((group) => {
              const checked = activeGroupIds.includes(group.id);
              return (
                <label
                  key={group.id}
                  className="flex min-h-8 cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 transition-colors hover:bg-subtle"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => handleToggleGroup(group.id, !!v)}
                    disabled={pendingGroupId === group.id}
                    className="shrink-0"
                  />
                  <span className="min-w-0 truncate text-body text-fg-1">
                    {group.name}
                  </span>
                  {group.description && (
                    <span className="min-w-0 flex-1 truncate text-caption text-fg-2">
                      {group.description}
                    </span>
                  )}
                </label>
              );
            })
          )}
        </CollapsibleContent>
      </Collapsible>

      <Collapsible defaultOpen className="space-y-0.5">
        <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-control bg-subtle px-2 py-1 text-left text-caption font-medium text-fg-2 hover:text-fg-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
          <ChevronRight
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90"
          />
          {t("workspaces.bindSkills", "Skill")}
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-0.5">
          {skills.length === 0 ? (
            <div className="px-2 py-2 text-body text-fg-2">
              {t("workspaces.noSkillsAvailable", "还没有已安装的 Skill")}
            </div>
          ) : (
            orderedSkills.map((skill) => {
              const checked = selectedSkillIds.has(skill.id);
              return (
                <label
                  key={skill.id}
                  className="flex min-h-8 cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 transition-colors hover:bg-subtle"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => handleToggleSkill(skill.id, !!v)}
                    disabled={pendingSkillId === skill.id}
                    className="shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-body text-fg-1">
                      {skill.name}
                    </div>
                    {skill.description && (
                      <div className="truncate text-caption text-fg-2">
                        {skill.description}
                      </div>
                    )}
                  </div>
                </label>
              );
            })
          )}
        </CollapsibleContent>
      </Collapsible>

      {bindings && (
        <div className="px-2 text-caption text-fg-2">
          {t("workspaces.totalSkills", "共 {{count}} 个 Skill 将被同步", {
            count: bindings.totalSkillCount,
          })}
        </div>
      )}
    </div>
  );
}

export function WorkspacesPanel() {
  const { t } = useTranslation();
  const { data: workspaces = [], isLoading } = useWorkspaces();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [editState, setEditState] = useState<{
    open: boolean;
    workspace: Workspace | null;
  }>({ open: false, workspace: null });

  const [confirmDelete, setConfirmDelete] = useState<{
    open: boolean;
    workspace: Workspace | null;
  }>({ open: false, workspace: null });

  const createMutation = useCreateWorkspace();
  const updateMutation = useUpdateWorkspace();
  const deleteMutation = useDeleteWorkspace();

  const handleSave = async (params: { name: string; path: string }) => {
    try {
      if (editState.workspace) {
        await updateMutation.mutateAsync({
          id: editState.workspace.id,
          ...params,
        });
        toast.success(t("workspaces.updated", "工作空间已更新"));
      } else {
        await createMutation.mutateAsync(params);
        toast.success(t("workspaces.created", "工作空间已创建"));
      }
      setEditState({ open: false, workspace: null });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), {
        description: String(error),
      });
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete.workspace) return;
    try {
      await deleteMutation.mutateAsync(confirmDelete.workspace.id);
      toast.success(t("workspaces.deleted", "工作空间已删除"));
      if (expandedId === confirmDelete.workspace.id) setExpandedId(null);
      setConfirmDelete({ open: false, workspace: null });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), {
        description: String(error),
      });
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-fg-2" />
      </div>
    );
  }

  const orderedWorkspaces = [...workspaces].sort(
    (a, b) => Number(b.isUserLevel) - Number(a.isUserLevel),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-body text-fg-2">
          {t(
            "workspaces.description",
            "将项目目录与 Skill 分组绑定，一键同步到局部配置",
          )}
        </p>
        <Button
          variant="neutral"
          size="compact"
          onClick={() => setEditState({ open: true, workspace: null })}
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          {t("workspaces.new", "新建工作空间")}
        </Button>
      </div>

      {workspaces.length === 0 ? (
        <div className="py-12 text-center text-body text-fg-2">
          {t("workspaces.empty", "还没有工作空间，点击「新建工作空间」开始")}
        </div>
      ) : (
        <div
          role="list"
          className="divide-y divide-border overflow-hidden rounded-panel border border-border bg-surface"
        >
          {orderedWorkspaces.map((ws) => {
            const expanded = expandedId === ws.id;
            return (
              <div key={ws.id} role="listitem">
                <div
                  className="flex min-h-14 cursor-pointer select-none items-center gap-2.5 px-3 py-2 transition-colors hover:bg-subtle"
                  onClick={() => toggleExpand(ws.id)}
                >
                  {expanded ? (
                    <ChevronDown
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 text-fg-2"
                    />
                  ) : (
                    <ChevronRight
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 text-fg-2"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-body font-medium text-fg-1">
                      {ws.name}
                    </div>
                    <div className="mt-0.5 truncate text-caption text-fg-2">
                      {ws.path}
                    </div>
                  </div>
                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!ws.isUserLevel && (
                      <>
                        <Button
                          variant="quiet"
                          size="icon-compact"
                          aria-label={t(
                            "workspaces.editAriaLabel",
                            "编辑工作空间：{{name}}",
                            { name: ws.name },
                          )}
                          onClick={() =>
                            setEditState({ open: true, workspace: ws })
                          }
                        >
                          <Edit2 aria-hidden="true" className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="quiet"
                          size="icon-compact"
                          className="hover:text-danger-text"
                          aria-label={t(
                            "workspaces.deleteAriaLabel",
                            "删除工作空间：{{name}}",
                            { name: ws.name },
                          )}
                          onClick={() =>
                            setConfirmDelete({ open: true, workspace: ws })
                          }
                        >
                          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {expanded && (
                  <div className="border-t border-border bg-surface">
                    <WorkspaceBindingsList workspace={ws} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <WorkspaceEditDialog
        open={editState.open}
        workspace={editState.workspace}
        onClose={() => setEditState({ open: false, workspace: null })}
        onSave={handleSave}
        saving={createMutation.isPending || updateMutation.isPending}
      />

      <V7ConfirmDialog
        open={confirmDelete.open}
        title={t("workspaces.deleteTitle", "删除工作空间")}
        body={t(
          "workspaces.deleteMessage",
          "确认删除「{{name}}」？不会删除目录下已同步的 Skill 文件。",
          { name: confirmDelete.workspace?.name },
        )}
        confirmLabel={t("common.delete", "删除")}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete({ open: false, workspace: null })}
      />
    </div>
  );
}
