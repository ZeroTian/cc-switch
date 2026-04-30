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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppToggleGroup } from "@/components/common/AppToggleGroup";
import { SKILLS_APP_IDS } from "@/config/appConfig";
import { useInstalledSkills } from "@/hooks/useSkills";
import {
  useGroupMemberIds,
  useAddSkillToGroup,
  useRemoveSkillFromGroup,
} from "@/hooks/useSkillGroups";
import type { AppId } from "@/lib/api/types";
import type { SkillGroup, SkillGroupApps } from "@/lib/api/skills";
import { DEFAULT_GROUP_APPS } from "@/lib/api/skillGroups";

interface Props {
  open: boolean;
  group: SkillGroup | null;
  onClose: () => void;
  onSave: (params: { name: string; description?: string; apps: SkillGroupApps }) => void;
  saving?: boolean;
}

export function SkillGroupEditDialog({ open, group, onClose, onSave, saving }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [apps, setApps] = useState<SkillGroupApps>(DEFAULT_GROUP_APPS);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) {
      setName(group?.name ?? "");
      setDescription(group?.description ?? "");
      setApps(group?.apps ?? DEFAULT_GROUP_APPS);
      setSearch("");
    }
  }, [open, group]);

  const { data: installedSkills = [] } = useInstalledSkills();
  const { data: memberIds = [] } = useGroupMemberIds(group?.id ?? null);
  const addMutation = useAddSkillToGroup();
  const removeMutation = useRemoveSkillFromGroup();

  const filtered = installedSkills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.description ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const toggleMember = (skillId: string, checked: boolean) => {
    if (!group) return;
    if (checked) {
      addMutation.mutate({ groupId: group.id, skillId });
    } else {
      removeMutation.mutate({ groupId: group.id, skillId });
    }
  };

  const handleToggleApp = (app: AppId, enabled: boolean) => {
    setApps((prev) => ({ ...prev, [app]: enabled }));
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      apps,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" zIndex="top">
        <DialogHeader>
          <DialogTitle>
            {group ? t("skillGroups.edit", "编辑分组") : t("skillGroups.create", "新建分组")}
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4 space-y-3">
          <Input
            placeholder={t("skillGroups.namePlaceholder", "分组名称")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Textarea
            placeholder={t("skillGroups.descriptionPlaceholder", "描述（可选）")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {t("skillGroups.appsLabel", "适用 Agent")}
            </span>
            <TooltipProvider delayDuration={300}>
              <AppToggleGroup
                apps={apps as unknown as Record<AppId, boolean>}
                onToggle={handleToggleApp}
                appIds={SKILLS_APP_IDS}
              />
            </TooltipProvider>
          </div>
        </div>

        {group && (
          <div className="px-6 pb-2 space-y-2">
            <div className="text-sm font-medium">
              {t("skillGroups.selectSkills", "选择 Skill")}
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("skillGroups.searchSkills", "搜索 Skill")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="max-h-52 overflow-y-auto space-y-1 border rounded-md p-2">
              {filtered.length === 0 ? (
                <div className="text-sm text-muted-foreground py-2 text-center">
                  {t("skillGroups.noSkills", "没有已安装的 Skill")}
                </div>
              ) : (
                filtered.map((skill) => {
                  const checked = memberIds.includes(skill.id);
                  const enabledApps = Object.entries(skill.apps)
                    .filter(([k, v]) => v && k !== "openclaw")
                    .map(([k]) => k);
                  return (
                    <label
                      key={skill.id}
                      className="flex items-start gap-2 cursor-pointer rounded px-1 py-1 hover:bg-accent"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => toggleMember(skill.id, !!v)}
                        disabled={addMutation.isPending || removeMutation.isPending}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{skill.name}</div>
                        {skill.description && (
                          <div className="text-xs text-muted-foreground truncate">
                            {skill.description}
                          </div>
                        )}
                        <div className="flex gap-1 mt-0.5 flex-wrap">
                          {enabledApps.map((app) => (
                            <Badge key={app} variant="secondary" className="text-[10px] py-0 px-1">
                              {app}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel", "取消")}
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("common.save", "保存")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
