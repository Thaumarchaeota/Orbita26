use super::types::{
    AiConfig, ApiEntry, AppSettings, GridPrefs, Integrations, LifeRingColors, LifeRingSlot,
    LifeRingSlots, UiPrefs,
};

pub(crate) const DEFAULT_V2RAY: &str = "";
pub(crate) const DEFAULT_ZOTERO_DATA: &str = "";
pub(crate) const DEFAULT_ARTICLE_NOTE: &str = "";
pub(crate) const DEFAULT_TICKTICK_REDIRECT: &str = "http://127.0.0.1:8765/callback";

pub(crate) fn default_grid_gap() -> u8 {
    8
}

pub(crate) fn default_tile_scale() -> u8 {
    100
}

pub(crate) fn default_bookmarks_cols() -> u8 {
    2
}

pub(crate) fn default_bookmarks_rows() -> u8 {
    5
}

pub(crate) fn default_apps_cols() -> u8 {
    6
}

pub(crate) fn default_apps_rows() -> u8 {
    3
}

pub(crate) fn default_top_cols() -> u8 {
    6
}

pub(crate) fn default_top_rows() -> u8 {
    3
}

pub(crate) fn default_dock_left_cols() -> u8 {
    2
}

pub(crate) fn default_dock_left_rows() -> u8 {
    5
}

pub(crate) fn default_top_grid() -> GridPrefs {
    GridPrefs {
        cols: default_top_cols(),
        rows: default_top_rows(),
        tile_scale: default_tile_scale(),
        col_gap: default_grid_gap(),
        row_gap: default_grid_gap(),
    }
}

pub(crate) fn default_dock_left_grid() -> GridPrefs {
    GridPrefs {
        cols: default_dock_left_cols(),
        rows: default_dock_left_rows(),
        tile_scale: default_tile_scale(),
        col_gap: default_grid_gap(),
        row_gap: default_grid_gap(),
    }
}

pub(crate) fn default_bookmarks_grid() -> GridPrefs {
    GridPrefs {
        cols: default_bookmarks_cols(),
        rows: default_bookmarks_rows(),
        tile_scale: default_tile_scale(),
        col_gap: default_grid_gap(),
        row_gap: default_grid_gap(),
    }
}

pub(crate) fn default_apps_grid() -> GridPrefs {
    GridPrefs {
        cols: default_apps_cols(),
        rows: default_apps_rows(),
        tile_scale: default_tile_scale(),
        col_gap: default_grid_gap(),
        row_gap: default_grid_gap(),
    }
}

pub(crate) fn default_font_base() -> String {
    "system".into()
}

pub(crate) fn default_font_inherit() -> String {
    "inherit".into()
}

pub(crate) fn default_font_literature() -> String {
    "harding".into()
}

pub(crate) fn default_font_clock() -> String {
    "ubuntu".into()
}

pub(crate) fn default_font_life_ring() -> String {
    "ubuntu".into()
}

pub(crate) fn default_font_life_ring_sub() -> String {
    "helvetica".into()
}

pub(crate) fn default_ring_sleep() -> String {
    "#5ac8fa".into()
}

pub(crate) fn default_ring2() -> String {
    "#34c759".into()
}

pub(crate) fn default_ring3() -> String {
    "#ff9500".into()
}

pub(crate) fn default_life_rings() -> LifeRingColors {
    LifeRingColors {
        sleep: default_ring_sleep(),
        ring2: default_ring2(),
        ring3: default_ring3(),
    }
}

pub(crate) fn default_ring_slot_metric_water() -> String {
    "water".into()
}

pub(crate) fn default_ring_slot_metric_steps() -> String {
    "steps".into()
}

pub(crate) fn default_goal_water() -> u32 {
    2000
}

pub(crate) fn default_goal_steps() -> u32 {
    10000
}

pub(crate) fn default_ring2_slot() -> LifeRingSlot {
    LifeRingSlot {
        metric: default_ring_slot_metric_water(),
        goal: default_goal_water(),
    }
}

pub(crate) fn default_ring3_slot() -> LifeRingSlot {
    LifeRingSlot {
        metric: default_ring_slot_metric_steps(),
        goal: default_goal_steps(),
    }
}

pub(crate) fn default_goal_intake() -> u32 {
    2000
}

pub(crate) fn default_goal_exp() -> u32 {
    2000
}

pub(crate) fn default_goal_hydration() -> u32 {
    2000
}

pub(crate) fn default_theme_palette() -> String {
    "ocean".into()
}

pub(crate) fn default_theme_hue() -> u16 {
    212
}

pub(crate) fn default_surface_light() -> String {
    "light".into()
}

pub(crate) fn default_theme_mode() -> String {
    "opaque".into()
}

pub(crate) fn default_glass_tint() -> String {
    "ink".into()
}

pub(crate) fn default_glass_hue() -> u16 {
    222
}

pub(crate) fn default_block_opacity() -> u8 {
    12
}

pub(crate) fn default_engine_id() -> String {
    "google".into()
}

pub(crate) fn default_local_tab() -> String {
    "file".into()
}

pub(crate) fn default_v2ray_path() -> String {
    DEFAULT_V2RAY.into()
}

pub(crate) fn default_zotero_data() -> String {
    DEFAULT_ZOTERO_DATA.into()
}

pub(crate) fn default_article_note() -> String {
    DEFAULT_ARTICLE_NOTE.into()
}

pub(crate) fn default_ticktick_project() -> String {
    "inbox".into()
}

pub(crate) fn default_ticktick_redirect() -> String {
    DEFAULT_TICKTICK_REDIRECT.into()
}

pub(crate) fn default_work_notes_dir() -> String {
    "12_project-tracking".into()
}

pub(crate) fn default_version() -> u32 {
    0
}

pub(crate) fn default_ai_entry_id() -> String {
    "deepseek-default".into()
}

pub(crate) fn default_ai_model() -> String {
    "deepseek-chat".into()
}

pub(crate) fn default_ai_entries() -> Vec<ApiEntry> {
    let entry_id = default_ai_entry_id();
    vec![ApiEntry {
        id: entry_id,
        name: "DeepSeek".into(),
        api_key: String::new(),
        base_url: "https://api.deepseek.com".into(),
        models: vec!["deepseek-chat".into(), "deepseek-reasoner".into()],
    }]
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
