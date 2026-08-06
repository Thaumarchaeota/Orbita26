use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct GridPrefs {
    #[serde(default = "super::defaults::default_bookmarks_cols")]
    pub cols: u8,
    #[serde(default = "super::defaults::default_bookmarks_rows")]
    pub rows: u8,
    #[serde(default = "super::defaults::default_tile_scale")]
    pub tile_scale: u8,
    #[serde(default = "super::defaults::default_grid_gap")]
    pub col_gap: u8,
    #[serde(default = "super::defaults::default_grid_gap")]
    pub row_gap: u8,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FontPrefs {
    #[serde(default = "super::defaults::default_font_base")]
    pub base: String,
    #[serde(default = "super::defaults::default_font_inherit")]
    pub launcher: String,
    #[serde(default = "super::defaults::default_font_inherit")]
    pub file_tree: String,
    #[serde(default = "super::defaults::default_font_literature")]
    pub literature: String,
    #[serde(default = "super::defaults::default_font_inherit")]
    pub note: String,
    #[serde(default = "super::defaults::default_font_inherit")]
    pub ai: String,
    #[serde(default = "super::defaults::default_font_clock")]
    pub clock: String,
    #[serde(default = "super::defaults::default_font_life_ring")]
    pub life_ring: String,
    #[serde(default = "super::defaults::default_font_life_ring_sub")]
    pub life_ring_sub: String,
}

impl Default for FontPrefs {
    fn default() -> Self {
        Self {
            base: super::defaults::default_font_base(),
            launcher: super::defaults::default_font_inherit(),
            file_tree: super::defaults::default_font_inherit(),
            literature: super::defaults::default_font_literature(),
            note: super::defaults::default_font_inherit(),
            ai: super::defaults::default_font_inherit(),
            clock: super::defaults::default_font_clock(),
            life_ring: super::defaults::default_font_life_ring(),
            life_ring_sub: super::defaults::default_font_life_ring_sub(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LifeRingColors {
    #[serde(default = "super::defaults::default_ring_sleep")]
    pub sleep: String,
    #[serde(default = "super::defaults::default_ring2")]
    pub ring2: String,
    #[serde(default = "super::defaults::default_ring3")]
    pub ring3: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LifeRingSlot {
    #[serde(default = "super::defaults::default_ring_slot_metric_water")]
    pub metric: String,
    #[serde(default = "super::defaults::default_goal_water")]
    pub goal: u32,
}

impl Default for LifeRingSlot {
    fn default() -> Self {
        Self {
            metric: super::defaults::default_ring_slot_metric_water(),
            goal: super::defaults::default_goal_water(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LifeRingSlots {
    #[serde(default = "super::defaults::default_ring2_slot")]
    pub ring2: LifeRingSlot,
    #[serde(default = "super::defaults::default_ring3_slot")]
    pub ring3: LifeRingSlot,
}

impl Default for LifeRingSlots {
    fn default() -> Self {
        Self {
            ring2: super::defaults::default_ring2_slot(),
            ring3: super::defaults::default_ring3_slot(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LifeRingGoals {
    #[serde(default = "super::defaults::default_goal_intake")]
    pub goal_intake: u32,
    #[serde(default = "super::defaults::default_goal_exp")]
    pub goal_exp: u32,
    #[serde(default = "super::defaults::default_goal_hydration")]
    pub goal_hydration: u32,
}

impl Default for LifeRingGoals {
    fn default() -> Self {
        Self {
            goal_intake: super::defaults::default_goal_intake(),
            goal_exp: super::defaults::default_goal_exp(),
            goal_hydration: super::defaults::default_goal_hydration(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpaqueThemePrefs {
    #[serde(default = "super::defaults::default_theme_palette")]
    pub palette: String,
    #[serde(default = "super::defaults::default_theme_hue")]
    pub hue: u16,
    #[serde(default = "super::defaults::default_surface_light")]
    pub surface: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct TransparentThemePrefs {
    #[serde(default = "super::defaults::default_surface_light")]
    pub surface: String,
    #[serde(default = "super::defaults::default_glass_tint")]
    pub tint: String,
    #[serde(default = "super::defaults::default_glass_hue")]
    pub hue: u16,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThemePrefs {
    #[serde(default = "super::defaults::default_theme_mode")]
    pub mode: String,
    #[serde(default)]
    pub opaque: OpaqueThemePrefs,
    #[serde(default)]
    pub transparent: TransparentThemePrefs,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UiPrefs {
    #[serde(default = "super::defaults::default_engine_id")]
    pub engine_id: String,
    #[serde(default = "super::defaults::default_local_tab")]
    pub local_tab: String,
    #[serde(default)]
    pub active_conversation_id: Option<String>,
    #[serde(default)]
    pub theme_prefs: ThemePrefs,
    #[serde(default = "super::defaults::default_block_opacity")]
    pub block_opacity: u8,
    #[serde(default = "super::defaults::default_top_grid")]
    pub top_grid: GridPrefs,
    #[serde(default = "super::defaults::default_life_rings")]
    pub life_rings: LifeRingColors,
    #[serde(default)]
    pub life_ring_slots: LifeRingSlots,
    #[serde(default)]
    pub life_ring_goals: LifeRingGoals,
    #[serde(default)]
    pub fonts: FontPrefs,
    #[serde(default = "super::defaults::default_dock_left_grid", skip_serializing)]
    pub dock_left_grid: GridPrefs,
    #[serde(default = "super::defaults::default_bookmarks_grid", skip_serializing)]
    pub bookmarks_grid: GridPrefs,
    #[serde(default = "super::defaults::default_apps_grid", skip_serializing)]
    pub apps_grid: GridPrefs,
}

impl Default for UiPrefs {
    fn default() -> Self {
        Self {
            engine_id: super::defaults::default_engine_id(),
            local_tab: super::defaults::default_local_tab(),
            active_conversation_id: None,
            theme_prefs: ThemePrefs::default(),
            block_opacity: super::defaults::default_block_opacity(),
            top_grid: super::defaults::default_top_grid(),
            life_rings: super::defaults::default_life_rings(),
            life_ring_slots: LifeRingSlots::default(),
            life_ring_goals: LifeRingGoals::default(),
            fonts: FontPrefs::default(),
            dock_left_grid: super::defaults::default_dock_left_grid(),
            bookmarks_grid: super::defaults::default_bookmarks_grid(),
            apps_grid: super::defaults::default_apps_grid(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct V2rayIntegration {
    #[serde(default = "super::defaults::default_v2ray_path")]
    pub exe_path: String,
}

impl Default for V2rayIntegration {
    fn default() -> Self {
        Self {
            exe_path: super::defaults::default_v2ray_path(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroIntegration {
    #[serde(default = "super::defaults::default_zotero_data")]
    pub data_dir: String,
    #[serde(default = "super::defaults::default_article_note")]
    pub article_note_dir: String,
}

impl Default for ZoteroIntegration {
    fn default() -> Self {
        Self {
            data_dir: super::defaults::default_zotero_data(),
            article_note_dir: super::defaults::default_article_note(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianIntegration {
    #[serde(default)]
    pub vault_dir: String,
}

impl Default for ObsidianIntegration {
    fn default() -> Self {
        Self {
            vault_dir: String::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EverythingIntegration {
    #[serde(default)]
    pub exe_path: String,
}

impl Default for EverythingIntegration {
    fn default() -> Self {
        Self {
            exe_path: String::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CursorIntegration {
    #[serde(default)]
    pub exe_path: String,
}

impl Default for CursorIntegration {
    fn default() -> Self {
        Self {
            exe_path: String::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TicktickIntegration {
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
    #[serde(default = "super::defaults::default_ticktick_redirect")]
    pub redirect_uri: String,
    #[serde(default)]
    pub access_token: String,
    #[serde(default = "super::defaults::default_ticktick_project")]
    pub default_project_id: String,
}

impl Default for TicktickIntegration {
    fn default() -> Self {
        Self {
            client_id: String::new(),
            client_secret: String::new(),
            redirect_uri: super::defaults::default_ticktick_redirect(),
            access_token: String::new(),
            default_project_id: super::defaults::default_ticktick_project(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct JournalIntegration {
    #[serde(default)]
    pub data_root: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BkeasyIntegration {
    #[serde(default)]
    pub data_root: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct GarminIntegration {
    #[serde(default)]
    pub token_dir: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkIntegration {
    #[serde(default = "super::defaults::default_work_notes_dir")]
    pub project_notes_dir: String,
    #[serde(default)]
    pub ticktick_project_id: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct GarminCredentials {
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub password: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct TicktickCredentials {
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
    #[serde(default)]
    pub access_token: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiCredentials {
    #[serde(default)]
    pub entries: std::collections::HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationsCredentials {
    #[serde(default)]
    pub garmin: GarminCredentials,
    #[serde(default)]
    pub ticktick: TicktickCredentials,
    #[serde(default)]
    pub ai: AiCredentials,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Integrations {
    #[serde(default)]
    pub v2ray: V2rayIntegration,
    #[serde(default)]
    pub zotero: ZoteroIntegration,
    #[serde(default)]
    pub obsidian: ObsidianIntegration,
    #[serde(default)]
    pub everything: EverythingIntegration,
    #[serde(default)]
    pub cursor: CursorIntegration,
    #[serde(default)]
    pub ticktick: TicktickIntegration,
    #[serde(default)]
    pub journal: JournalIntegration,
    #[serde(default)]
    pub bkeasy: BkeasyIntegration,
    #[serde(default)]
    pub garmin: GarminIntegration,
    #[serde(default)]
    pub work: WorkIntegration,
    #[serde(default)]
    pub credentials: IntegrationsCredentials,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "super::defaults::default_version")]
    pub version: u32,
    pub theme: String,
    pub data_dir: String,
    #[serde(default)]
    pub ui: UiPrefs,
    #[serde(default)]
    pub integrations: Integrations,
    #[serde(default)]
    pub ai: AiConfig,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct Bootstrap {
    pub data_dir: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiEntry {
    pub id: String,
    pub name: String,
    pub api_key: String,
    pub base_url: String,
    pub models: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    #[serde(default)]
    pub default_prompt: String,
    #[serde(default = "super::defaults::default_ai_entry_id")]
    pub active_entry_id: String,
    #[serde(default = "super::defaults::default_ai_model")]
    pub active_model: String,
    #[serde(default = "super::defaults::default_ai_entries")]
    pub entries: Vec<ApiEntry>,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            default_prompt: String::new(),
            active_entry_id: super::defaults::default_ai_entry_id(),
            active_model: super::defaults::default_ai_model(),
            entries: super::defaults::default_ai_entries(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMeta {
    pub id: String,
    pub title: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub conversation_prompt: String,
    pub messages: Vec<ChatMessage>,
    pub active_entry_id: String,
    pub active_model: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BookmarkEntry {
    #[serde(rename = "link")]
    Link {
        id: String,
        name: String,
        url: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        icon: Option<String>,
    },
    Folder {
        id: String,
        name: String,
        children: Vec<BookmarkLink>,
    },
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BookmarkLink {
    #[serde(rename = "link")]
    Link {
        id: String,
        name: String,
        url: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        icon: Option<String>,
    },
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppEntry {
    #[serde(rename = "app")]
    App {
        id: String,
        name: String,
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        icon: Option<String>,
    },
    Folder {
        id: String,
        name: String,
        children: Vec<AppLink>,
    },
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppLink {
    #[serde(rename = "app")]
    App {
        id: String,
        name: String,
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        icon: Option<String>,
    },
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LocalEntry {
    #[serde(rename = "file")]
    File {
        id: String,
        name: String,
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<String>,
    },
    #[serde(rename = "folder")]
    FolderShortcut {
        id: String,
        name: String,
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<String>,
    },
    Group {
        id: String,
        name: String,
        children: Vec<LocalEntry>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<String>,
    },
}

pub type Bookmark = BookmarkEntry;
pub type AppItem = AppEntry;
pub type LocalFileItem = LocalEntry;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LegacyAiSettings {
    pub provider: Option<String>,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LegacyAppSettings {
    pub theme: Option<String>,
    #[allow(dead_code)]
    pub data_dir: Option<String>,
    pub ai: Option<LegacyAiSettings>,
}
