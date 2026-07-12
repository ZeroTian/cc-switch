import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, FolderOpen, Search } from "lucide-react";
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
      <DialogContent className="max-w-lg" zIndex="top">
        <DialogHeader>
          <DialogTitle>
            {workspace
              ? t("workspaces.edit", "编辑工作空间")
              : t("workspaces.create", "新建工作空间")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 min-h-0">
          <Input
            placeholder={t("workspaces.namePlaceholder", "工作空间名称")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex gap-2">
            <Input
              placeholder={t("workspaces.pathPlaceholder", "项目目录路径")}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleBrowse}
              type="button"
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>

          {workspace && (
            <div className="space-y-2">
              <div className="text-sm font-medium">
                {t("workspaces.bindGroups", "绑定分组")}
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("workspaces.searchGroups", "搜索分组")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <div className="space-y-1 border rounded-md p-2 max-h-48 overflow-y-auto">
                {filteredGroups.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-2 text-center">
                    {t("workspaces.noGroups", "没有可用分组")}
                  </div>
                ) : (
                  filteredGroups.map((group) => {
                    const checked = boundGroupIds.includes(group.id);
                    return (
                      <label
                        key={group.id}
                        className="flex items-center gap-2 cursor-pointer rounded px-1 py-1 hover:bg-accent"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => toggleGroup(group.id, !!v)}
                          disabled={
                            addMutation.isPending || removeMutation.isPending
                          }
                        />
                        <span className="text-sm">{group.name}</span>
                        {group.description && (
                          <span className="text-xs text-muted-foreground truncate flex-1">
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

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel", "取消")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || !path.trim() || saving}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("common.save", "保存")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
