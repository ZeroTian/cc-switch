import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Plus, Edit2, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { V7ConfirmDialog } from "@/components/mcp/formBits";
import { SkillGroupEditDialog } from "./SkillGroupEditDialog";
import { APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";
import {
  MatrixCell,
  MatrixColumnHeader,
  MatrixColumnHighlight,
} from "@/components/mcp/AppMatrix";
import { useVisibleAppIds } from "@/components/mcp/useVisibleAppIds";
import { SKILLS_APP_IDS } from "@/config/appConfig";
import {
  useSkillGroups,
  useCreateSkillGroup,
  useUpdateSkillGroup,
  useDeleteSkillGroup,
} from "@/hooks/useSkillGroups";
import type { SkillGroup, SkillGroupApps } from "@/lib/api/skills";

export function SkillGroupsPanel() {
  const { t } = useTranslation();
  const { data: groups = [], isLoading } = useSkillGroups();
  const appIds = useVisibleAppIds(SKILLS_APP_IDS);

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

  const handleSave = async (params: {
    name: string;
    description?: string;
    apps: SkillGroupApps;
  }) => {
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
      toast.error(t("common.error", "操作失败"), {
        description: String(error),
      });
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete.group) return;
    try {
      await deleteMutation.mutateAsync(confirmDelete.group.id);
      toast.success(t("skillGroups.deleted", "分组已删除"));
      setConfirmDelete({ open: false, group: null });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), {
        description: String(error),
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-fg-2" />
      </div>
    );
  }

  return (
    <div className="space-y-3 text-body text-fg-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-body text-fg-2">
          {t(
            "skillGroups.description",
            "管理 Skill 分组及成员；激活范围请在「工作空间」中配置",
          )}
        </p>
        <Button
          variant="neutral"
          size="compact"
          className="shrink-0"
          onClick={() => setEditDialogState({ open: true, group: null })}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("skillGroups.new", "新建分组")}
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-panel border border-border bg-surface py-12 text-center text-body text-fg-2">
          {t("skillGroups.empty", "还没有分组，点击「新建分组」开始")}
        </div>
      ) : (
        <div className="scroll-stable overflow-auto rounded-panel border border-border bg-surface">
          <MatrixColumnHighlight>
            <div className="min-w-[600px]">
              <div className="flex h-11 items-center border-b border-border bg-subtle px-2">
                <span className="min-w-0 flex-1 ps-2 text-body font-medium text-fg-2">
                  {t("skillGroups.title", "分组")}
                </span>
                <div className="flex shrink-0">
                  {appIds.map((app) => {
                    const count = groups.filter(
                      (group) => group.apps[app as keyof SkillGroupApps],
                    ).length;
                    return (
                      <MatrixColumnHeader
                        key={app}
                        app={app}
                        enabledCount={count}
                        totalCount={groups.length}
                        scopeTotal={groups.length}
                        scopeEnabled={count}
                        scopeFailed={0}
                        scopeKind="all"
                        noun={t("skillGroups.title", "分组")}
                        title={`${APP_DISPLAY_NAME[app]} · ${t("skillGroups.appsLabel", "适用 Agent")} · ${count}/${groups.length}`}
                      />
                    );
                  })}
                </div>
                <div className="w-16 shrink-0" />
              </div>
              <div role="list" className="divide-y divide-border">
                {groups.map((group) => (
                  <div
                    key={group.id}
                    role="listitem"
                    className="flex min-h-14 items-center px-2 py-2 transition-colors hover:bg-subtle"
                  >
                    <div className="min-w-0 flex-1 ps-2 pe-3">
                      <span className="block truncate text-body font-medium">
                        {group.name}
                      </span>
                      {group.description && (
                        <p className="m-0 mt-0.5 truncate text-caption text-fg-2">
                          {group.description}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0">
                      {appIds.map((app) => {
                        const enabled =
                          group.apps[app as keyof SkillGroupApps] ?? false;
                        const label = `${group.name} · ${APP_DISPLAY_NAME[app]} · ${t("skillGroups.appsLabel", "适用 Agent")} ${enabled ? "✓" : "—"}`;
                        return (
                          <MatrixCell
                            key={app}
                            app={app}
                            state={enabled ? "on" : "off"}
                            label={label}
                          />
                        );
                      })}
                    </div>
                    <div className="flex w-16 shrink-0 items-center justify-end gap-1">
                      <Button
                        variant="quiet"
                        size="icon-compact"
                        aria-label={`${t("skillGroups.edit", "编辑分组")}：${group.name}`}
                        onClick={() =>
                          setEditDialogState({ open: true, group })
                        }
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="quiet"
                        size="icon-compact"
                        className="hover:text-danger-text"
                        aria-label={`${t("skillGroups.deleteTitle", "删除分组")}：${group.name}`}
                        onClick={() => setConfirmDelete({ open: true, group })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </MatrixColumnHighlight>
        </div>
      )}

      <SkillGroupEditDialog
        open={editDialogState.open}
        group={editDialogState.group}
        onClose={() => setEditDialogState({ open: false, group: null })}
        onSave={handleSave}
        saving={createMutation.isPending || updateMutation.isPending}
      />

      <V7ConfirmDialog
        open={confirmDelete.open}
        title={t("skillGroups.deleteTitle", "删除分组")}
        body={t(
          "skillGroups.deleteMessage",
          "确认删除「{{name}}」？分组内的 Skill 不会被卸载。",
          { name: confirmDelete.group?.name },
        )}
        confirmLabel={t("common.delete", "删除")}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete({ open: false, group: null })}
      />
    </div>
  );
}
