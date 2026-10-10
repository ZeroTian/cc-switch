import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { DialogTitle } from "@/components/ui/dialog";
import { V7Dialog } from "@/components/mcp/formBits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { SearchField } from "@/components/ui/search-field";
import { AppGlyph, APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";
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
  onSave: (params: {
    name: string;
    description?: string;
    apps: SkillGroupApps;
  }) => void;
  saving?: boolean;
}

export function SkillGroupEditDialog({
  open,
  group,
  onClose,
  onSave,
  saving,
}: Props) {
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

  const selectedSkillIds = new Set(memberIds);
  const filtered = installedSkills
    .filter(
      (s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.description ?? "").toLowerCase().includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(selectedSkillIds.has(b.id)) - Number(selectedSkillIds.has(a.id)),
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
    <V7Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogTitle className="text-section">
        {group
          ? t("skillGroups.edit", "编辑分组")
          : t("skillGroups.create", "新建分组")}
      </DialogTitle>

      <div className="min-h-0 space-y-4 overflow-y-auto text-body">
        <Input
          placeholder={t("skillGroups.namePlaceholder", "分组名称")}
          aria-label={t("skillGroups.namePlaceholder", "分组名称")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Textarea
          placeholder={t("skillGroups.descriptionPlaceholder", "描述（可选）")}
          value={description}
          aria-label={t("skillGroups.descriptionPlaceholder", "描述（可选）")}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
        <div className="space-y-2">
          <div className="text-body font-medium text-fg-1">
            {t("skillGroups.appsLabel", "适用 Agent")}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {SKILLS_APP_IDS.map((app) => (
              <label
                key={app}
                className="flex cursor-pointer items-center gap-2 text-caption text-fg-1"
              >
                <Checkbox
                  checked={apps[app as keyof SkillGroupApps] ?? false}
                  onCheckedChange={(checked) => handleToggleApp(app, checked)}
                />
                <AppGlyph app={app} size={14} badgeClassName="bg-surface" />
                {APP_DISPLAY_NAME[app]}
              </label>
            ))}
          </div>
        </div>

        {group && (
          <div className="space-y-2">
            <div className="text-body font-medium text-fg-1">
              {t("skillGroups.selectSkills", "选择 Skill")}
            </div>
            <SearchField
              placeholder={t("skillGroups.searchSkills", "搜索 Skill")}
              aria-label={t("skillGroups.searchSkills", "搜索 Skill")}
              value={search}
              onValueChange={setSearch}
              clearLabel={t("common.clear", "清除")}
            />
            <div className="max-h-60 divide-y divide-border overflow-y-auto rounded-panel border border-border bg-surface">
              {filtered.length === 0 ? (
                <div className="py-6 text-center text-body text-fg-2">
                  {t("skillGroups.noSkills", "没有已安装的 Skill")}
                </div>
              ) : (
                filtered.map((skill) => {
                  const checked = selectedSkillIds.has(skill.id);
                  return (
                    <label
                      key={skill.id}
                      className="flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-subtle/50"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => toggleMember(skill.id, !!v)}
                        disabled={
                          addMutation.isPending || removeMutation.isPending
                        }
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-body font-medium text-fg-1">
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
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="neutral" size="regular" onClick={onClose}>
          {t("common.cancel", "取消")}
        </Button>
        <Button
          variant="solid"
          size="regular"
          onClick={handleSave}
          disabled={!name.trim() || saving}
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("common.save", "保存")}
        </Button>
      </div>
    </V7Dialog>
  );
}
