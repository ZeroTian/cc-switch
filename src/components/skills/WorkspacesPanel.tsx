import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Plus, Edit2, Trash2, FolderCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { WorkspaceEditDialog } from "./WorkspaceEditDialog";
import {
  useWorkspaces,
  useCreateWorkspace,
  useUpdateWorkspace,
  useDeleteWorkspace,
  useApplyWorkspace,
} from "@/hooks/useWorkspaces";
import type { Workspace } from "@/lib/api/workspaces";

export function WorkspacesPanel() {
  const { t } = useTranslation();
  const { data: workspaces = [], isLoading } = useWorkspaces();

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
  const applyMutation = useApplyWorkspace();

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
      setConfirmDelete({ open: false, workspace: null });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    }
  };

  const handleApply = async (workspace: Workspace) => {
    try {
      const result = await applyMutation.mutateAsync(workspace.id);
      if (result.failed.length > 0) {
        toast.warning(t("workspaces.applyPartial", "部分同步完成"), {
          description: t(
            "workspaces.applyFailedList",
            "{{synced}} 个成功，失败：{{failed}}",
            { synced: result.synced, failed: result.failed.join("、") }
          ),
        });
      } else {
        toast.success(
          t("workspaces.applySuccess", "已同步 {{count}} 个 Skill", { count: result.synced }),
          { description: workspace.path }
        );
      }
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    }
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
          {workspaces.map((ws) => (
            <div key={ws.id} className="flex items-center gap-4 rounded-lg border px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{ws.name}</div>
                <div className="text-xs text-muted-foreground truncate mt-0.5">{ws.path}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t("workspaces.groupCount", "{{count}} 个分组", { count: ws.groupIds.length })}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 text-xs px-3"
                  onClick={() => handleApply(ws)}
                  disabled={applyMutation.isPending}
                >
                  <FolderCheck className="h-3 w-3 mr-1" />
                  {t("workspaces.apply", "应用")}
                </Button>
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
          ))}
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
