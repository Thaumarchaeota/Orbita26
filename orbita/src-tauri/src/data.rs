use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const DEFAULT_V2RAY: &str = "";
const DEFAULT_ZOTERO_DATA: &str = "";
const DEFAULT_ARTICLE_NOTE: &str = "";

#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct GridPrefs {
    #[serde(default = "default_bookmarks_cols")]
    pub cols: u8,
    #[serde(default = "default_bookmarks_rows")]
    pub rows: u8,
    #[serde(default = "default_tile_scale")]
    pub tile_scale: u8,
    #[serde(default = "default_grid_gap")]
    pub col_gap: u8,
    #[serde(default = "default_grid_gap")]
    pub row_gap: u8,
}

fn default_grid_gap() -> u8 {
    8
}

fn default_tile_scale() -> u8 {
    100
}

fn default_bookmarks_cols() -> u8 {
    2
}

fn default_bookmarks_rows() -> u8 {
    5
}

fn default_apps_cols() -> u8 {
    6
}

fn default_apps_rows() -> u8 {
    3
}

fn default_top_cols() -> u8 {
    6
}

fn default_top_rows() -> u8 {
    3
}

fn default_dock_left_cols() -> u8 {
    2
}

fn default_dock_left_rows() -> u8 {
    5
}

fn default_top_grid() -> GridPrefs {
    GridPrefs {
        cols: default_top_cols(),
        rows: default_top_rows(),
        tile_scale: default_tile_scale(),
        col_gap: default_grid_gap(),
        row_gap: default_grid_gap(),
    }
}

fn default_dock_left_grid() -> GridPrefs {
    GridPrefs {
        cols: default_dock_left_cols(),
        rows: default_dock_left_rows(),
        tile_scale: default_tile_scale(),
        col_gap: default_grid_gap(),
        row_gap: default_grid_gap(),
    }
}

fn default_bookmarks_grid() -> GridPrefs {
    GridPrefs {
        cols: default_bookmarks_cols(),
        rows: default_bookmarks_rows(),
        tile_scale: default_tile_scale(),
        col_gap: default_grid_gap(),
        row_gap: default_grid_gap(),
    }
}

fn default_apps_grid() -> GridPrefs {
    GridPrefs {
        cols: default_apps_cols(),
        rows: default_apps_rows(),
        tile_scale: default_tile_scale(),
        col_gap: default_grid_gap(),
        row_gap: default_grid_gap(),
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FontPrefs {
    #[serde(default = "default_font_base")]
    pub base: String,
    #[serde(default = "default_font_inherit")]
    pub launcher: String,
    #[serde(default = "default_font_inherit")]
    pub file_tree: String,
    #[serde(default = "default_font_literature")]
    pub literature: String,
    #[serde(default = "default_font_inherit")]
    pub note: String,
    #[serde(default = "default_font_inherit")]
    pub ai: String,
    #[serde(default = "default_font_clock")]
    pub clock: String,
    #[serde(default = "default_font_life_ring")]
    pub life_ring: String,
    #[serde(default = "default_font_life_ring_sub")]
    pub life_ring_sub: String,
}

fn default_font_base() -> String {
    "system".into()
}

fn default_font_inherit() -> String {
    "inherit".into()
}

fn default_font_literature() -> String {
    "harding".into()
}

fn default_font_clock() -> String {
    "ubuntu".into()
}

fn default_font_life_ring() -> String {
    "ubuntu".into()
}

fn default_font_life_ring_sub() -> String {
    "helvetica".into()
}

impl Default for FontPrefs {
    fn default() -> Self {
        Self {
            base: default_font_base(),
            launcher: default_font_inherit(),
            file_tree: default_font_inherit(),
            literature: default_font_literature(),
            note: default_font_inherit(),
            ai: default_font_inherit(),
            clock: default_font_clock(),
            life_ring: default_font_life_ring(),
            life_ring_sub: default_font_life_ring_sub(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LifeRingColors {
    #[serde(default = "default_ring_sleep")]
    pub sleep: String,
    #[serde(default = "default_ring2")]
    pub ring2: String,
    #[serde(default = "default_ring3")]
    pub ring3: String,
}

fn default_ring_sleep() -> String {
    "#5ac8fa".into()
}
fn default_ring2() -> String {
    "#34c759".into()
}
fn default_ring3() -> String {
    "#ff9500".into()
}

fn default_life_rings() -> LifeRingColors {
    LifeRingColors {
        sleep: default_ring_sleep(),
        ring2: default_ring2(),
        ring3: default_ring3(),
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LifeRingSlot {
    #[serde(default = "default_ring_slot_metric_water")]
    pub metric: String,
    #[serde(default = "default_goal_water")]
    pub goal: u32,
}

fn default_ring_slot_metric_water() -> String {
    "water".into()
}
fn default_ring_slot_metric_steps() -> String {
    "steps".into()
}
fn default_goal_water() -> u32 {
    2000
}
fn default_goal_steps() -> u32 {
    10000
}

impl Default for LifeRingSlot {
    fn default() -> Self {
        Self {
            metric: default_ring_slot_metric_water(),
            goal: default_goal_water(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LifeRingSlots {
    #[serde(default = "default_ring2_slot")]
    pub ring2: LifeRingSlot,
    #[serde(default = "default_ring3_slot")]
    pub ring3: LifeRingSlot,
}

fn default_ring2_slot() -> LifeRingSlot {
    LifeRingSlot {
        metric: default_ring_slot_metric_water(),
        goal: default_goal_water(),
    }
}

fn default_ring3_slot() -> LifeRingSlot {
    LifeRingSlot {
        metric: default_ring_slot_metric_steps(),
        goal: default_goal_steps(),
    }
}

impl Default for LifeRingSlots {
    fn default() -> Self {
        Self {
            ring2: default_ring2_slot(),
            ring3: default_ring3_slot(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LifeRingGoals {
    #[serde(default = "default_goal_intake")]
    pub goal_intake: u32,
    #[serde(default = "default_goal_exp")]
    pub goal_exp: u32,
    #[serde(default = "default_goal_hydration")]
    pub goal_hydration: u32,
}

fn default_goal_intake() -> u32 {
    2000
}
fn default_goal_exp() -> u32 {
    2000
}
fn default_goal_hydration() -> u32 {
    2000
}

impl Default for LifeRingGoals {
    fn default() -> Self {
        Self {
            goal_intake: default_goal_intake(),
            goal_exp: default_goal_exp(),
            goal_hydration: default_goal_hydration(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UiPrefs {
    #[serde(default = "default_engine_id")]
    pub engine_id: String,
    #[serde(default = "default_local_tab")]
    pub local_tab: String,
    #[serde(default)]
    pub active_conversation_id: Option<String>,
    #[serde(default = "default_block_opacity")]
    pub block_opacity: u8,
    #[serde(default = "default_top_grid")]
    pub top_grid: GridPrefs,
    #[serde(default = "default_life_rings")]
    pub life_rings: LifeRingColors,
    #[serde(default)]
    pub life_ring_slots: LifeRingSlots,
    #[serde(default)]
    pub life_ring_goals: LifeRingGoals,
    #[serde(default)]
    pub fonts: FontPrefs,
    #[serde(default = "default_dock_left_grid", skip_serializing)]
    pub dock_left_grid: GridPrefs,
    #[serde(default = "default_bookmarks_grid", skip_serializing)]
    pub bookmarks_grid: GridPrefs,
    #[serde(default = "default_apps_grid", skip_serializing)]
    pub apps_grid: GridPrefs,
}

fn default_block_opacity() -> u8 {
    12
}

fn default_engine_id() -> String {
    "google".into()
}

fn default_local_tab() -> String {
    "file".into()
}

impl Default for UiPrefs {
    fn default() -> Self {
        Self {
            engine_id: default_engine_id(),
            local_tab: default_local_tab(),
            active_conversation_id: None,
            block_opacity: default_block_opacity(),
            top_grid: default_top_grid(),
            life_rings: default_life_rings(),
            life_ring_slots: LifeRingSlots::default(),
            life_ring_goals: LifeRingGoals::default(),
            fonts: FontPrefs::default(),
            dock_left_grid: default_dock_left_grid(),
            bookmarks_grid: default_bookmarks_grid(),
            apps_grid: default_apps_grid(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct V2rayIntegration {
    #[serde(default = "default_v2ray_path")]
    pub exe_path: String,
}

fn default_v2ray_path() -> String {
    DEFAULT_V2RAY.into()
}

impl Default for V2rayIntegration {
    fn default() -> Self {
        Self {
            exe_path: default_v2ray_path(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroIntegration {
    #[serde(default = "default_zotero_data")]
    pub data_dir: String,
    #[serde(default = "default_article_note")]
    pub article_note_dir: String,
}

fn default_zotero_data() -> String {
    DEFAULT_ZOTERO_DATA.into()
}

fn default_article_note() -> String {
    DEFAULT_ARTICLE_NOTE.into()
}

impl Default for ZoteroIntegration {
    fn default() -> Self {
        Self {
            data_dir: default_zotero_data(),
            article_note_dir: default_article_note(),
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

const DEFAULT_TICKTICK_REDIRECT: &str = "http://127.0.0.1:8765/callback";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TicktickIntegration {
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
    #[serde(default = "default_ticktick_redirect")]
    pub redirect_uri: String,
    #[serde(default)]
    pub access_token: String,
    #[serde(default = "default_ticktick_project")]
    pub default_project_id: String,
}

fn default_ticktick_project() -> String {
    "inbox".into()
}

fn default_ticktick_redirect() -> String {
    DEFAULT_TICKTICK_REDIRECT.into()
}

impl Default for TicktickIntegration {
    fn default() -> Self {
        Self {
            client_id: String::new(),
            client_secret: String::new(),
            redirect_uri: default_ticktick_redirect(),
            access_token: String::new(),
            default_project_id: default_ticktick_project(),
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
    pub credentials: IntegrationsCredentials,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_version")]
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

fn default_version() -> u32 {
    0
}

#[derive(Serialize, Deserialize)]
struct Bootstrap {
    data_dir: String,
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
    #[serde(default = "default_ai_entry_id")]
    pub active_entry_id: String,
    #[serde(default = "default_ai_model")]
    pub active_model: String,
    #[serde(default = "default_ai_entries")]
    pub entries: Vec<ApiEntry>,
}

fn default_ai_entry_id() -> String {
    "deepseek-default".into()
}

fn default_ai_model() -> String {
    "deepseek-chat".into()
}

fn default_ai_entries() -> Vec<ApiEntry> {
    let entry_id = default_ai_entry_id();
    vec![ApiEntry {
        id: entry_id,
        name: "DeepSeek".into(),
        api_key: String::new(),
        base_url: "https://api.deepseek.com".into(),
        models: vec!["deepseek-chat".into(), "deepseek-reasoner".into()],
    }]
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            default_prompt: String::new(),
            active_entry_id: default_ai_entry_id(),
            active_model: default_ai_model(),
            entries: default_ai_entries(),
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
struct LegacyAiSettings {
    provider: Option<String>,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyAppSettings {
    theme: Option<String>,
    #[allow(dead_code)]
    data_dir: Option<String>,
    ai: Option<LegacyAiSettings>,
}

fn bootstrap_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())
        .map(|p| p.join("bootstrap.json"))
}

pub fn default_data_dir(app: &tauri::AppHandle) -> Result<String, String> {
    let p = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("data");
    Ok(p.to_string_lossy().into())
}

pub fn get_data_dir(app: &tauri::AppHandle) -> Result<String, String> {
    let bp = bootstrap_path(app)?;
    if bp.exists() {
        let raw = fs::read_to_string(&bp).map_err(|e| e.to_string())?;
        let b: Bootstrap = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        return Ok(b.data_dir);
    }
    let default = default_data_dir(app)?;
    set_data_dir(app, default.clone())?;
    Ok(default)
}

pub fn set_data_dir(app: &tauri::AppHandle, path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let bp = bootstrap_path(app)?;
    if let Some(parent) = bp.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let b = Bootstrap { data_dir: path };
    fs::write(
        &bp,
        serde_json::to_string_pretty(&b).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn settings_path(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("settings.json")
}

fn ai_config_path(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("ai").join("config.json")
}

fn conversations_dir(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("ai").join("conversations")
}

fn conversation_path(data_dir: &str, id: &str) -> Result<PathBuf, String> {
    validate_conversation_id(id)?;
    Ok(conversations_dir(data_dir).join(format!("{id}.json")))
}

pub fn bookmarks_path(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("bookmarks.json")
}

pub fn apps_path(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("apps.json")
}

pub fn local_files_path(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("local-files.json")
}

pub fn cache_icons_dir(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("cache").join("icons")
}

pub fn cache_favicons_dir(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("cache").join("favicons")
}

pub fn cache_file_type_icons_dir(data_dir: &str) -> PathBuf {
    Path::new(data_dir).join("cache").join("file-type-icons")
}

fn validate_conversation_id(id: &str) -> Result<(), String> {
    let ok = id.len() == 36
        && id.as_bytes().iter().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => *b == b'-',
            _ => b.is_ascii_hexdigit(),
        });
    if ok {
        Ok(())
    } else {
        Err("invalid conversation id".into())
    }
}

pub fn ensure_under_dir(path: &str, allowed_dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(allowed_dir).map_err(|e| e.to_string())?;
    let allowed = allowed_dir
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let target = PathBuf::from(path);
    let canon = if target.exists() {
        target.canonicalize().map_err(|e| e.to_string())?
    } else {
        let parent = target
            .parent()
            .ok_or_else(|| "invalid path".to_string())?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        parent.join(
            target
                .file_name()
                .ok_or_else(|| "invalid path".to_string())?,
        )
    };
    if !canon.starts_with(&allowed) {
        return Err("path outside cache dir".into());
    }
    Ok(canon)
}

pub fn default_settings(data_dir: &str) -> AppSettings {
    AppSettings {
        version: 1,
        theme: "light".into(),
        data_dir: data_dir.into(),
        ui: UiPrefs::default(),
        integrations: Integrations::default(),
        ai: AiConfig::default(),
    }
}

fn read_standalone_ai_config(data_dir: &str) -> Option<AiConfig> {
    let path = ai_config_path(data_dir);
    if !path.exists() {
        return None;
    }
    let raw = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn merge_ai_from_legacy_file(settings: &mut AppSettings, data_dir: &str) {
    if let Some(ai) = read_standalone_ai_config(data_dir) {
        let empty_key = settings
            .ai
            .entries
            .first()
            .map(|e| e.api_key.is_empty())
            .unwrap_or(true);
        if empty_key {
            settings.ai = ai;
        }
    }
}

pub fn read_settings(app: &tauri::AppHandle) -> Result<AppSettings, String> {
    let data_dir = get_data_dir(app)?;
    let path = settings_path(&data_dir);
    if !path.exists() {
        let mut s = default_settings(&data_dir);
        merge_ai_from_legacy_file(&mut s, &data_dir);
        write_json(&path, &s)?;
        return Ok(s);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if let Ok(mut s) = serde_json::from_str::<AppSettings>(&raw) {
        s.data_dir = data_dir.clone();
        merge_ai_from_legacy_file(&mut s, &data_dir);
        return Ok(s);
    }
    if let Ok(legacy) = serde_json::from_str::<LegacyAppSettings>(&raw) {
        let mut s = default_settings(&data_dir);
        s.version = 0;
        s.theme = legacy.theme.unwrap_or_else(|| "light".into());
        if let Some(ai) = legacy.ai {
            apply_legacy_ai(&mut s.ai, ai);
        }
        merge_ai_from_legacy_file(&mut s, &data_dir);
        write_json(&path, &s)?;
        return Ok(s);
    }
    Err("invalid settings.json".into())
}

fn apply_legacy_ai(config: &mut AiConfig, ai: LegacyAiSettings) {
    if let Some(key) = ai.api_key.filter(|s| !s.is_empty()) {
        if let Some(entry) = config.entries.first_mut() {
            entry.api_key = key;
        }
    }
    if let Some(url) = ai.base_url.filter(|s| !s.is_empty()) {
        if let Some(entry) = config.entries.first_mut() {
            entry.base_url = url;
        }
    }
    if let Some(model) = ai.model.filter(|s| !s.is_empty()) {
        config.active_model = model;
    }
}

pub fn write_settings(app: &tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let current = get_data_dir(app)?;
    if settings.data_dir != current {
        set_data_dir(app, settings.data_dir.clone())?;
    }
    let data_dir = get_data_dir(app)?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let mut s = settings;
    s.data_dir = data_dir;
    if s.version == 0 {
        s.version = 1;
    }
    write_json(&settings_path(&s.data_dir), &s)
}

pub fn read_ai_config(app: &tauri::AppHandle) -> Result<AiConfig, String> {
    Ok(read_settings(app)?.ai)
}

pub fn write_ai_config(app: &tauri::AppHandle, config: AiConfig) -> Result<(), String> {
    let mut settings = read_settings(app)?;
    settings.ai = config;
    write_settings(app, settings)
}

pub fn list_conversations(app: &tauri::AppHandle) -> Result<Vec<ConversationMeta>, String> {
    let data_dir = get_data_dir(app)?;
    let dir = conversations_dir(&data_dir);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut items = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let conv: Conversation = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        items.push(ConversationMeta {
            id: conv.id,
            title: conv.title,
            updated_at: conv.updated_at,
        });
    }
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

pub fn read_conversation(app: &tauri::AppHandle, id: String) -> Result<Conversation, String> {
    let data_dir = get_data_dir(app)?;
    let path = conversation_path(&data_dir, &id)?;
    if !path.exists() {
        return Err("conversation not found".into());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn write_conversation(app: &tauri::AppHandle, conversation: Conversation) -> Result<(), String> {
    let data_dir = get_data_dir(app)?;
    let dir = conversations_dir(&data_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = conversation_path(&data_dir, &conversation.id)?;
    write_json(&path, &conversation)
}

pub fn delete_conversation(app: &tauri::AppHandle, id: String) -> Result<(), String> {
    let data_dir = get_data_dir(app)?;
    let path = conversation_path(&data_dir, &id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn read_json_array<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Vec<T>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn migrate_legacy_bookmark(value: &serde_json::Value) -> Option<BookmarkEntry> {
    let id = value.get("id")?.as_str()?;
    let name = value.get("name")?.as_str()?;
    if value.get("kind").and_then(|k| k.as_str()) == Some("folder") {
        let children: Vec<BookmarkLink> = value
            .get("children")?
            .as_array()?
            .iter()
            .filter_map(|c| migrate_legacy_bookmark_link(c))
            .collect();
        return Some(BookmarkEntry::Folder {
            id: id.into(),
            name: name.into(),
            children,
        });
    }
    if value.get("kind").is_some() {
        return serde_json::from_value(value.clone()).ok();
    }
    let url = value.get("url")?.as_str()?;
    let icon = value
        .get("icon")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some(BookmarkEntry::Link {
        id: id.into(),
        name: name.into(),
        url: url.into(),
        icon,
    })
}

fn migrate_legacy_bookmark_link(value: &serde_json::Value) -> Option<BookmarkLink> {
    if value.get("kind").is_some() {
        return serde_json::from_value(value.clone()).ok();
    }
    let id = value.get("id")?.as_str()?;
    let name = value.get("name")?.as_str()?;
    let url = value.get("url")?.as_str()?;
    let icon = value
        .get("icon")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some(BookmarkLink::Link {
        id: id.into(),
        name: name.into(),
        url: url.into(),
        icon,
    })
}

fn migrate_legacy_app(value: &serde_json::Value) -> Option<AppEntry> {
    let id = value.get("id")?.as_str()?;
    let name = value.get("name")?.as_str()?;
    if value.get("kind").and_then(|k| k.as_str()) == Some("folder") {
        let children: Vec<AppLink> = value
            .get("children")?
            .as_array()?
            .iter()
            .filter_map(|c| migrate_legacy_app_link(c))
            .collect();
        return Some(AppEntry::Folder {
            id: id.into(),
            name: name.into(),
            children,
        });
    }
    if value.get("kind").is_some() {
        return serde_json::from_value(value.clone()).ok();
    }
    let path = value.get("path")?.as_str()?;
    let icon = value
        .get("icon")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some(AppEntry::App {
        id: id.into(),
        name: name.into(),
        path: path.into(),
        icon,
    })
}

fn migrate_legacy_app_link(value: &serde_json::Value) -> Option<AppLink> {
    if value.get("kind").is_some() {
        return serde_json::from_value(value.clone()).ok();
    }
    let id = value.get("id")?.as_str()?;
    let name = value.get("name")?.as_str()?;
    let path = value.get("path")?.as_str()?;
    let icon = value
        .get("icon")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some(AppLink::App {
        id: id.into(),
        name: name.into(),
        path: path.into(),
        icon,
    })
}

fn migrate_legacy_local(value: &serde_json::Value) -> Option<LocalEntry> {
    if value.get("kind").and_then(|k| k.as_str()) == Some("group") {
        let id = value.get("id")?.as_str()?;
        let name = value.get("name")?.as_str()?;
        let children: Vec<LocalEntry> = value
            .get("children")?
            .as_array()?
            .iter()
            .filter_map(migrate_legacy_local)
            .collect();
        return Some(LocalEntry::Group {
            id: id.into(),
            name: name.into(),
            children,
            color: None,
        });
    }
    if value.get("kind").is_some() {
        return serde_json::from_value(value.clone()).ok();
    }
    let id = value.get("id")?.as_str()?;
    let name = value.get("name")?.as_str()?;
    let path = value.get("path")?.as_str()?;
    let kind = value.get("kind").and_then(|k| k.as_str()).unwrap_or("file");
    if kind == "folder" {
        return Some(LocalEntry::FolderShortcut {
            id: id.into(),
            name: name.into(),
            path: path.into(),
            color: None,
        });
    }
    Some(LocalEntry::File {
        id: id.into(),
        name: name.into(),
        path: path.into(),
        color: None,
    })
}

fn read_json_bookmarks(path: &Path) -> Result<Vec<BookmarkEntry>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let Some(arr) = value.as_array() else {
        return Ok(vec![]);
    };
    Ok(arr.iter().filter_map(migrate_legacy_bookmark).collect())
}

fn read_json_apps(path: &Path) -> Result<Vec<AppEntry>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let Some(arr) = value.as_array() else {
        return Ok(vec![]);
    };
    Ok(arr.iter().filter_map(migrate_legacy_app).collect())
}

fn read_json_local(path: &Path) -> Result<Vec<LocalEntry>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let Some(arr) = value.as_array() else {
        return Ok(vec![]);
    };
    Ok(arr.iter().filter_map(migrate_legacy_local).collect())
}

pub fn read_bookmarks(app: &tauri::AppHandle) -> Result<Vec<BookmarkEntry>, String> {
    let data_dir = get_data_dir(app)?;
    read_json_bookmarks(&bookmarks_path(&data_dir))
}

pub fn write_bookmarks(app: &tauri::AppHandle, items: Vec<BookmarkEntry>) -> Result<(), String> {
    let data_dir = get_data_dir(app)?;
    write_json(&bookmarks_path(&data_dir), &items)
}

pub fn read_apps(app: &tauri::AppHandle) -> Result<Vec<AppEntry>, String> {
    let data_dir = get_data_dir(app)?;
    read_json_apps(&apps_path(&data_dir))
}

pub fn write_apps(app: &tauri::AppHandle, items: Vec<AppEntry>) -> Result<(), String> {
    let data_dir = get_data_dir(app)?;
    write_json(&apps_path(&data_dir), &items)
}

pub fn read_local_files(app: &tauri::AppHandle) -> Result<Vec<LocalEntry>, String> {
    let data_dir = get_data_dir(app)?;
    read_json_local(&local_files_path(&data_dir))
}

pub fn write_local_files(app: &tauri::AppHandle, items: Vec<LocalEntry>) -> Result<(), String> {
    let data_dir = get_data_dir(app)?;
    write_json(&local_files_path(&data_dir), &items)
}

pub fn migrate_legacy_caches(app: &tauri::AppHandle) -> Result<u32, String> {
    let data_dir = get_data_dir(app)?;
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut moved = 0u32;
    moved += copy_dir_files(&app_data.join("icons"), &cache_icons_dir(&data_dir))?;
    moved += copy_dir_files(&app_data.join("favicons"), &cache_favicons_dir(&data_dir))?;
    Ok(moved)
}

fn copy_dir_files(from: &Path, to: &Path) -> Result<u32, String> {
    if !from.exists() {
        return Ok(0);
    }
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    let mut n = 0u32;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name() else {
            continue;
        };
        let dest = to.join(name);
        if !dest.exists() {
            fs::copy(&path, &dest).map_err(|e| e.to_string())?;
            n += 1;
        }
    }
    Ok(n)
}

pub fn rewrite_icon_paths(app: &tauri::AppHandle) -> Result<(), String> {
    let data_dir = get_data_dir(app)?;
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let old_icons = app_data.join("icons").to_string_lossy().into_owned();
    let old_favicons = app_data.join("favicons").to_string_lossy().into_owned();
    let new_icons = cache_icons_dir(&data_dir).to_string_lossy().into_owned();
    let new_favicons = cache_favicons_dir(&data_dir).to_string_lossy().into_owned();

    let mut bookmarks = read_bookmarks(app)?;
    let mut apps = read_apps(app)?;
    let mut changed = false;
    for b in &mut bookmarks {
        match b {
            BookmarkEntry::Link { icon, .. } => {
                if let Some(icon) = icon {
                    if icon.starts_with(&old_favicons) {
                        *icon = icon.replacen(&old_favicons, &new_favicons, 1);
                        changed = true;
                    }
                }
            }
            BookmarkEntry::Folder { children, .. } => {
                for child in children {
                    if let BookmarkLink::Link { icon, .. } = child {
                        if let Some(icon) = icon {
                            if icon.starts_with(&old_favicons) {
                                *icon = icon.replacen(&old_favicons, &new_favicons, 1);
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
    }
    for a in &mut apps {
        match a {
            AppEntry::App { icon, .. } => {
                if let Some(icon) = icon {
                    if icon.starts_with(&old_icons) {
                        *icon = icon.replacen(&old_icons, &new_icons, 1);
                        changed = true;
                    }
                }
            }
            AppEntry::Folder { children, .. } => {
                for child in children {
                    if let AppLink::App { icon, .. } = child {
                        if let Some(icon) = icon {
                            if icon.starts_with(&old_icons) {
                                *icon = icon.replacen(&old_icons, &new_icons, 1);
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
    }
    if changed {
        write_bookmarks(app, bookmarks)?;
        write_apps(app, apps)?;
    }
    Ok(())
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(
        path,
        serde_json::to_string_pretty(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
