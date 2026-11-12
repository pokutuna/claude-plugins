/** A settings layer, lowest precedence first. */
export type Layer = "user" | "project" | "local";

export type Tab = "plugins" | "skills";

/** A `skillOverrides` value. */
export type SkillMode = "on" | "name-only" | "user-invocable-only" | "off";

/** The settings key a row belongs to. */
export type SectionKey = "enabledPlugins" | "skillOverrides";

/** A value one layer holds for a row; null is "not set". */
export type CellValue = boolean | SkillMode | null;

/** One plugin and its `enabledPlugins` value in each layer (null: not set). */
export type PluginRow = {
  id: string;
  /** Where it is installed: for the user (any project), this project alone, or not at all. */
  installed: "user" | "project" | null;
  user: boolean | null;
  project: boolean | null;
  local: boolean | null;
};

/** One skill and its `skillOverrides` value in each layer (null: not set). */
export type SkillRow = {
  name: string;
  /** Where it was found: a skills folder, or only as a key in skillOverrides. */
  origin: "user" | "project" | "override";
  user: SkillMode | null;
  project: SkillMode | null;
  local: SkillMode | null;
};

export type Snapshot = {
  cwd: string;
  /** The settings file of each layer. */
  files: Record<Layer, string>;
  plugins: PluginRow[];
  skills: SkillRow[];
  /** Layers whose file could not be read, and why; their cells are not offered. */
  broken: Partial<Record<Layer, string>>;
};

/** A change pressed in the pane and not yet saved. */
export type Edit = {
  layer: Layer;
  /** The settings file the change is for, so it never lands in another folder's. */
  file: string;
  section: SectionKey;
  key: string;
  /** The value the file held when the change was pressed. */
  from: CellValue;
  value: CellValue;
};

declare module "claude-code" {
  interface PluginState {
    "toggle-plugin": {
      tab: Tab;
      /** The last change, or failure, shown at the top of the pane. */
      message: string | null;
      snapshot: Shaped<Snapshot | null>;
      pending: Shaped<Edit[]>;
      /** True while the pane shows the changes and asks to save them. */
      isReviewing: boolean;
      /** True once Esc was refused for unsaved changes; the next Esc discards. */
      isCloseWarned: boolean;
    };
  }
}
