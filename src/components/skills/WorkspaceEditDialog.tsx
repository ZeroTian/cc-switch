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
import { Loader2, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { settingsApi } from "@/lib/api";
import type { Workspace } from "@/lib/api/workspaces";

interface Props {
  open: boolean;
  workspace: Workspace | null;
  onClose: () => void;
  onSave: (params: { name: string; path: string }) => void;
  saving?: boolean;
}

export function WorkspaceEditDialog({ open, workspace, onClose, onSave, saving }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");

  useEffect(() => {
    if (open) {
      setName(workspace?.name ?? "");
      setPath(workspace?.path ?? "");
    }
  }, [open, workspace]);

  const handleBrowse = async () => {
    try {
      const selected = await settingsApi.pickDirectory();
      if (selected) setPath(selected);
    } catch {
      // user cancelled
    }
  };

  const handleSave = () => {
    if (!name.trim() || !path.trim()) return;
    if (path.trim() === "~") {
      toast.error(t("workspaces.pathCannotBeHome", "路径不能为 ~"));
      return;
    }
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
            <Button variant="outline" size="sm" onClick={handleBrowse} type="button">
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
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
