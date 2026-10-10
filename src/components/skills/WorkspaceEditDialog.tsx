import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/ui/search-field";
import { Checkbox } from "@/components/ui/checkbox";
import { FIELD_CLASS } from "@/components/mcp/formBits";
import { Loader2, FolderOpen } from "lucide-react";
import { settingsApi } from "@/lib/api";
import { useSkillGroups } from "@/hooks/useSkillGroups";
import {
  useWorkspaces,
  useAddGroupToWorkspace,
  useRemoveGroupFromWorkspace,
} from "@/hooks/useWorkspaces";
import type { Workspace } from "@/lib/api/workspaces";

interface Props {
  open: boolean;
  workspace: Workspace | null;
  onClose: () => void;
  onSave: (params: { name: string; path: string }) => void;
  saving?: boolean;
}

export function WorkspaceEditDialog({
  open,
  workspace,
  onClose,
  onSave,
  saving,
}: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) {
      setName(workspace?.name ?? "");
      setPath(workspace?.path ?? "");
      setSearch("");
    }
  }, [open, workspace]);

  const { data: groups = [] } = useSkillGroups();
  const { data: workspaces = [] } = useWorkspaces();
  const addMutation = useAddGroupToWorkspace();
  const removeMutation = useRemoveGroupFromWorkspace();

  // 从缓存实时读取最新 groupIds，避免 prop 未更新导致勾选无效
  const liveWorkspace = workspace
    ? workspaces.find((w) => w.id === workspace.id)
    : null;
  const boundGroupIds = liveWorkspace?.groupIds ?? workspace?.groupIds ?? [];

  const filteredGroups = groups.filter((g) =>
    g.name.toLowerCase().includes(search.toLowerCase()),
  );

  const handleBrowse = async () => {
    try {
      const selected = await settingsApi.pickDirectory();
      if (selected) setPath(selected);
    } catch {
      // user cancelled
    }
  };

  const toggleGroup = (groupId: string, checked: boolean) => {
    if (!workspace) return;
    if (checked) {
      addMutation.mutate({ workspaceId: workspace.id, groupId });
    } else {
      removeMutation.mutate({ workspaceId: workspace.id, groupId });
    }
  };

  const handleSave = () => {
    if (!name.trim() || !path.trim()) return;
    onSave({ name: name.trim(), path: path.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        zIndex="top"
        aria-describedby={undefined}
        style={{ maxWidth: 480 }}
        className="max-h-[calc(100vh-48px)] gap-4 rounded-dialog border-border bg-surface p-6 text-fg-1 shadow-v7-lg sm:rounded-dialog"
      >
        <DialogTitle className="text-section [overflow-wrap:anywhere]">
          {workspace
            ? t("workspaces.edit", "编辑工作空间")
            : t("workspaces.create", "新建工作空间")}
        </DialogTitle>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <Input
            aria-label={t("workspaces.namePlaceholder", "工作空间名称")}
            placeholder={t("workspaces.namePlaceholder", "工作空间名称")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={FIELD_CLASS}
          />
          <div className="flex gap-2">
            <Input
              aria-label={t("workspaces.pathPlaceholder", "项目目录路径")}
              placeholder={t("workspaces.pathPlaceholder", "项目目录路径")}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className={`${FIELD_CLASS} flex-1`}
            />
            <Button
              variant="neutral"
              size="regular"
              className="w-8 shrink-0 p-0"
              aria-label={t("settings.browseDirectory", "浏览目录")}
              onClick={handleBrowse}
              type="button"
            >
              <FolderOpen aria-hidden="true" className="h-3.5 w-3.5" />
            </Button>
          </div>

          {workspace && (
            <div className="space-y-2">
              <div className="text-body font-medium text-fg-1">
                {t("workspaces.bindGroups", "绑定分组")}
              </div>
              <SearchField
                aria-label={t("workspaces.searchGroups", "搜索分组")}
                placeholder={t("workspaces.searchGroups", "搜索分组")}
                value={search}
                onValueChange={setSearch}
                clearLabel={t("mcpPage.clearSearch", "清除搜索")}
              />
              <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-panel border border-border bg-surface p-1">
                {filteredGroups.length === 0 ? (
                  <div className="py-3 text-center text-body text-fg-2">
                    {t("workspaces.noGroups", "没有可用分组")}
                  </div>
                ) : (
                  filteredGroups.map((group) => {
                    const checked = boundGroupIds.includes(group.id);
                    return (
                      <label
                        key={group.id}
                        className="flex min-h-8 cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 transition-colors hover:bg-subtle"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => toggleGroup(group.id, !!v)}
                          disabled={
                            addMutation.isPending || removeMutation.isPending
                          }
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
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2 pt-1">
          <Button variant="neutral" size="regular" onClick={onClose}>
            {t("common.cancel", "取消")}
          </Button>
          <Button
            variant="solid"
            size="regular"
            onClick={handleSave}
            disabled={!name.trim() || !path.trim() || saving}
          >
            {saving && (
              <Loader2
                aria-hidden="true"
                className="h-3.5 w-3.5 animate-spin"
              />
            )}
            {t("common.save", "保存")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
