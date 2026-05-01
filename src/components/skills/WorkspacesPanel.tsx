import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Edit2, Trash2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { WorkspaceEditDialog } from "./WorkspaceEditDialog";
import {
  useWorkspaces,
  useCreateWorkspace,
  useUpdateWorkspace,
  useDeleteWorkspace,
  useToggleGroupInWorkspace,
  useWorkspaceActiveGroupIds,
} from "@/hooks/useWorkspaces";
import { useSkillGroups } from "@/hooks/useSkillGroups";
import type { Workspace } from "@/lib/api/workspaces";

function WorkspaceGroupList({ workspace }: { workspace: Workspace }) {
  const { t } = useTranslation();
  const { data: groups = [] } = useSkillGroups();
  const { data: activeGroupIds = [] } = useWorkspaceActiveGroupIds(workspace.id);
  const toggleMutation = useToggleGroupInWorkspace();
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);

  const handleToggle = async (groupId: string, checked: boolean) => {
    setPendingGroupId(groupId);
    try {
      await toggleMutation.mutateAsync({ workspaceId: workspace.id, groupId, active: checked });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    } finally {
      setPendingGroupId(null);
    }
  };

  if (groups.length === 0) {
    return (
      <div className="px-4 py-3 text-sm text-muted-foreground">
        {t("workspaces.noGroupsAvailable", "还没有分组，请先在「分组」标签页创建分组")}
      </div>
    );
  }

  return (
    <div className="px-4 pb-3 space-y-1">
      {groups.map((group) => {
        const checked = activeGroupIds.includes(group.id);
        return (
          <label
            key={group.id}
            className="flex items-center gap-2 cursor-pointer rounded px-1 py-1.5 hover:bg-accent"
          >
            <Checkbox
              checked={checked}
              onCheckedChange={(v) => handleToggle(group.id, !!v)}
              disabled={pendingGroupId === group.id}
            />
            <span className={`text-sm ${checked ? "text-primary font-medium" : ""}`}>
              {group.name}
            </span>
            {group.description && (
              <span className="text-xs text-muted-foreground truncate flex-1">
                {group.description}
              </span>
            )}
          </label>
        );
      })}
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
        await updateMutation.mutateAsync({ id: editState.workspace.id, ...params });
        toast.success(t("workspaces.updated", "工作空间已更新"));
      } else {
        await createMutation.mutateAsync(params);
        toast.success(t("workspaces.created", "工作空间已创建"));
      }
      setEditState({ open: false, workspace: null });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
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
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("workspaces.description", "将项目目录与 Skill 分组绑定，一键同步到局部配置")}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditState({ open: true, workspace: null })}
        >
          <Plus className="h-4 w-4 mr-1" />
          {t("workspaces.new", "新建工作空间")}
        </Button>
      </div>

      {workspaces.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {t("workspaces.empty", "还没有工作空间，点击「新建工作空间」开始")}
        </div>
      ) : (
        <div className="space-y-2">
          {workspaces.map((ws) => {
            const expanded = expandedId === ws.id;
            return (
              <div key={ws.id} className="rounded-lg border border-border-default overflow-hidden">
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 select-none"
                  onClick={() => toggleExpand(ws.id)}
                >
                  {expanded
                    ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{ws.name}</div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">{ws.path}</div>
                  </div>
                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setEditState({ open: true, workspace: ws })}
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setConfirmDelete({ open: true, workspace: ws })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {expanded && (
                  <div className="border-t border-border-default bg-muted/20">
                    <WorkspaceGroupList workspace={ws} />
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

      <ConfirmDialog
        isOpen={confirmDelete.open}
        title={t("workspaces.deleteTitle", "删除工作空间")}
        message={t(
          "workspaces.deleteMessage",
          "确认删除「{{name}}」？不会删除目录下已同步的 Skill 文件。",
          { name: confirmDelete.workspace?.name }
        )}
        confirmText={t("common.delete", "删除")}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete({ open: false, workspace: null })}
      />
    </div>
  );
}
