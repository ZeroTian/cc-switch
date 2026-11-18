// 前端统一使用 AppId 作为应用标识（与后端命令参数 `app` 一致）
export type AppId =
  | "claude"
  | "claude-desktop"
  | "codex"
  | "gemini"
  | "grokbuild"
  | "opencode"
  | "openclaw"
  | "hermes"
  | "pi"
  | "kimi"
  | "dsh"
  | "mcode"
  | "agy"
  | "omp"
  | "copilot"
  | "workbuddy";

/** 技能目标也包含仅接入技能管理的桌面应用。 */
export type SkillAppId = AppId | "catpaw";
