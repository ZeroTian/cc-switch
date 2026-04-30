import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit2, Trash2, Play, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppToggleGroup } from "@/components/common/AppToggleGroup";
import { SKILLS_APP_IDS } from "@/config/appConfig";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SkillGroupEditDialog } from "./SkillGroupEditDialog";
import {
  useSkillGroups,
  useCreateSkillGroup,
  useUpdateSkillGroup,
  useDeleteSkillGroup,
  useActivateSkillGroup,
  useDeactivateAllSkillGroups,
} from "@/hooks/useSkillGroups";
import type { SkillGroup, SkillGroupApps } from "@/lib/api/skills";

export function SkillGroupsPanel() {
  const { t } = useTranslation();
  const { data: groups = [], isLoading } = useSkillGroups();

  const [editDialogState, setEditDialogState] = useState<{
    open: boolean;
    group: SkillGroup | null;
  }>({ open: false, group: null });

  const [confirmDelete, setConfirmDelete] = useState<{
    open: boolean;
    group: SkillGroup | null;
  }>({ open: false, group: null });

  const createMutation = useCreateSkillGroup();
  const updateMutation = useUpdateSkillGroup();
  const deleteMutation = useDeleteSkillGroup();
  const activateMutation = useActivateSkillGroup();
  const deactivateMutation = useDeactivateAllSkillGroups();

  const handleSave = async (params: { name: string; description?: string; apps: SkillGroupApps }) => {
    const { group } = editDialogState;
    try {
      if (group) {
        await updateMutation.mutateAsync({ id: group.id, ...params });
        toast.success(t("skillGroups.updated", "分组已更新"));
      } else {
        await createMutation.mutateAsync(params);
        toast.success(t("skillGroups.created", "分组已创建"));
      }
      setEditDialogState({ open: false, group: null });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete.group) return;
    try {
      await deleteMutation.mutateAsync(confirmDelete.group.id);
      toast.success(t("skillGroups.deleted", "分组已删除"));
      setConfirmDelete({ open: false, group: null });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    }
  };

  const handleActivate = async (group: SkillGroup) => {
    try {
      if (group.isActive) {
        await deactivateMutation.mutateAsync();
        toast.success(t("skillGroups.deactivated", "已停用分组"));
      } else {
        await activateMutation.mutateAsync(group.id);
        toast.success(t("skillGroups.activated", "已激活：{{name}}", { name: group.name }));
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
          {t("skillGroups.description", "将 Skill 按场景分组，一键切换当前激活集合")}
        </p>
        <Button
          size="sm"
          onClick={() => setEditDialogState({ open: true, group: null })}
        >
          <Plus className="h-4 w-4 mr-1" />
          {t("skillGroups.new", "新建分组")}
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {t("skillGroups.empty", "还没有分组，点击「新建分组」开始")}
        </div>
      ) : (
        <TooltipProvider delayDuration={300}>
        <div className="space-y-2">
          {groups.map((group) => (
            <div
              key={group.id}
              className={`flex items-center gap-4 rounded-lg border px-4 py-3 ${
                group.isActive ? "border-primary bg-primary/5" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{group.name}</span>
                  {group.isActive && (
                    <Badge variant="default" className="text-[10px] py-0 px-1.5">
                      {t("skillGroups.active", "激活中")}
                    </Badge>
                  )}
                </div>
                {group.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {group.description}
                  </p>
                )}
              </div>
              <AppToggleGroup
                apps={group.apps}
                onToggle={() => {}}
                appIds={SKILLS_APP_IDS}
              />
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant={group.isActive ? "secondary" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => handleActivate(group)}
                  disabled={activateMutation.isPending || deactivateMutation.isPending}
                >
                  {group.isActive ? (
                    <><Square className="h-3 w-3 mr-1" />{t("skillGroups.deactivate", "停用")}</>
                  ) : (
                    <><Play className="h-3 w-3 mr-1" />{t("skillGroups.activate", "激活")}</>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setEditDialogState({ open: true, group })}
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete({ open: true, group })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        </TooltipProvider>
      )}

      <SkillGroupEditDialog
        open={editDialogState.open}
        group={editDialogState.group}
        onClose={() => setEditDialogState({ open: false, group: null })}
        onSave={handleSave}
        saving={createMutation.isPending || updateMutation.isPending}
      />

      <ConfirmDialog
        isOpen={confirmDelete.open}
        title={t("skillGroups.deleteTitle", "删除分组")}
        message={t(
          "skillGroups.deleteMessage",
          "确认删除「{{name}}」？分组内的 Skill 不会被卸载。",
          { name: confirmDelete.group?.name }
        )}
        confirmText={t("common.delete", "删除")}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete({ open: false, group: null })}
      />
    </div>
  );
}
