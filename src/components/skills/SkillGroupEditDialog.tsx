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
import { Loader2, Search } from "lucide-react";
import { useInstalledSkills } from "@/hooks/useSkills";
import { useGroupMemberIds } from "@/hooks/useSkillGroups";
import type { SkillGroup } from "@/lib/api/skills";

interface Props {
  open: boolean;
  group: SkillGroup | null;
  onClose: () => void;
  onSave: (params: { name: string; description?: string; memberIds: string[] }) => void;
  saving?: boolean;
}

export function SkillGroupEditDialog({ open, group, onClose, onSave, saving }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [draftMemberIds, setDraftMemberIds] = useState<Set<string>>(new Set());

  const { data: installedSkills = [] } = useInstalledSkills();
  const { data: memberIds = [] } = useGroupMemberIds(group?.id ?? null);

  useEffect(() => {
    if (open) {
      setName(group?.name ?? "");
      setDescription(group?.description ?? "");
      setSearch("");
      setDraftMemberIds(new Set(memberIds));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group]);

  useEffect(() => {
    if (open && memberIds.length > 0) {
      setDraftMemberIds(new Set(memberIds));
    }
  }, [memberIds, open]);

  const filtered = installedSkills
    .filter(
      (s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.description ?? "").toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const aChecked = draftMemberIds.has(a.id) ? 0 : 1;
      const bChecked = draftMemberIds.has(b.id) ? 0 : 1;
      return aChecked - bChecked;
    });

  const toggleMember = (skillId: string) => {
    setDraftMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      memberIds: Array.from(draftMemberIds),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg flex flex-col max-h-[80vh]" zIndex="top">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {group ? t("skillGroups.edit", "编辑分组") : t("skillGroups.create", "新建分组")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col min-h-0 px-6 py-4 gap-3 overflow-hidden">
          <div className="shrink-0 space-y-3">
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
          </div>

          {group && (
            <div className="flex flex-col min-h-0 gap-2">
              <div className="text-sm font-medium shrink-0">
                {t("skillGroups.selectSkills", "选择 Skill")}
              </div>
              <div className="relative shrink-0">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("skillGroups.searchSkills", "搜索 Skill")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <div className="flex-1 overflow-y-auto border rounded-md p-1.5 min-h-0">
                {filtered.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-2 text-center">
                    {t("skillGroups.noSkills", "没有已安装的 Skill")}
                  </div>
                ) : (
                  filtered.map((skill) => {
                    const checked = draftMemberIds.has(skill.id);
                    return (
                      <button
                        type="button"
                        key={skill.id}
                        className={`w-full flex items-start gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                          checked ? "bg-primary/8 hover:bg-primary/12" : "hover:bg-accent"
                        }`}
                        onClick={() => toggleMember(skill.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate ${checked ? "text-primary" : ""}`}>
                            {skill.name}
                          </div>
                          {skill.description && (
                            <div className="text-xs text-muted-foreground truncate">
                              {skill.description}
                            </div>
                          )}
                        </div>
                      </button>
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
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("common.save", "保存")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
