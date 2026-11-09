// `data` is private to the Tauri library, so this integration test includes
// the real data modules. The source module references the search DTO through
// `crate::agent`; provide the exact serialization-only test shim it needs.
mod agent {
    pub mod web_search {
        use serde::{Deserialize, Serialize};

        #[derive(Clone, Debug, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase")]
        pub struct WebSource {
            pub title: String,
            pub url: String,
        }
    }
}

#[path = "../src/data/defaults.rs"]
mod defaults;
#[path = "../src/data/types.rs"]
mod types;

use serde_json::json;

#[test]
fn old_ui_preferences_deserialize_with_the_default_insight_palette() {
    let old = json!({
        "engineId": "google",
        "localTab": "file",
        "themePrefs": { "mode": "opaque" },
        "blockOpacity": 12,
    });

    let prefs: types::UiPrefs = serde_json::from_value(old).expect("old UiPrefs remain readable");
    let palette = prefs.insight_palette;

    assert_eq!(palette.primary, "#4B78B8");
    assert_eq!(palette.selected, "#D7E3F5");
    assert_eq!(palette.hover, "#E5EBF3");
    assert_eq!(palette.chrome, "#E4EBF3");
    assert_eq!(palette.sidebar, "#F1F5F9");
    assert_eq!(palette.page, "#F8FAFC");
    assert_eq!(palette.surface, "#FFFFFF");
    assert_eq!(palette.control_surface, "#FFFFFF");
    assert_eq!(palette.sunken, "#F1F5F9");
    assert_eq!(palette.text_primary, "#243044");
    assert_eq!(palette.text_secondary, "#66758A");
    assert_eq!(palette.border, "#D4DCE6");
    assert_eq!(palette.danger, "#C0393B");
}

#[test]
fn custom_palette_uses_camel_case_wire_keys_and_round_trips() {
    let custom = json!({
        "primary": "#102030",
        "selected": "#203040",
        "hover": "#304050",
        "chrome": "#405060",
        "sidebar": "#506070",
        "page": "#607080",
        "surface": "#708090",
        "controlSurface": "#8090A0",
        "sunken": "#90A0B0",
        "textPrimary": "#A0B0C0",
        "textSecondary": "#B0C0D0",
        "border": "#C0D0E0",
        "danger": "#D0E0F0",
    });

    let prefs: types::UiPrefs = serde_json::from_value(json!({ "insightPalette": custom }))
        .expect("custom palette is readable");
    assert_eq!(prefs.insight_palette.control_surface, "#8090A0");
    assert_eq!(prefs.insight_palette.text_primary, "#A0B0C0");
    assert_eq!(prefs.insight_palette.text_secondary, "#B0C0D0");

    let wire = serde_json::to_value(&prefs.insight_palette).expect("palette serializes");
    assert_eq!(wire["controlSurface"], "#8090A0");
    assert_eq!(wire["textPrimary"], "#A0B0C0");
    assert_eq!(wire["textSecondary"], "#B0C0D0");
    assert!(wire.get("control_surface").is_none());
}

#[test]
fn partially_saved_palette_defaults_only_missing_fields() {
    let prefs: types::UiPrefs = serde_json::from_value(json!({
        "insightPalette": {
            "primary": "#abcdef",
            "danger": "#fedcba"
        }
    }))
    .expect("partial palette is readable");

    assert_eq!(prefs.insight_palette.primary, "#abcdef");
    assert_eq!(prefs.insight_palette.danger, "#fedcba");
    assert_eq!(prefs.insight_palette.selected, "#D7E3F5");
    assert_eq!(prefs.insight_palette.text_primary, "#243044");
}

#[test]
fn legacy_insight_style_is_tolerated_but_not_written() {
    let prefs: types::UiPrefs = serde_json::from_value(json!({
        "insightTheme": "warm",
        "insightStyle": "rounded",
        "insightPalette": {}
    }))
    .expect("theme and style are readable");

    assert_eq!(prefs.insight_theme, "warm");
    let wire = serde_json::to_value(&prefs).expect("UiPrefs serializes");
    assert_eq!(wire["insightTheme"], "warm");
    assert!(wire.get("insightStyle").is_none());
    assert_eq!(wire["insightPalette"]["primary"], "#4B78B8");
}

#[test]
fn invalid_hex_is_replaced_and_valid_lowercase_hex_is_canonicalized() {
    let prefs: types::UiPrefs = serde_json::from_value(json!({
        "insightPalette": {
            "primary": "#abcdef",
            "selected": "#12345",
            "hover": "#1234567",
            "chrome": "blue",
            "danger": " #ABCDEF"
        }
    }))
    .expect("invalid palette values are recoverable");

    assert_eq!(prefs.insight_palette.primary, "#ABCDEF");
    assert_eq!(prefs.insight_palette.selected, "#D7E3F5");
    assert_eq!(prefs.insight_palette.hover, "#E5EBF3");
    assert_eq!(prefs.insight_palette.chrome, "#E4EBF3");
    assert_eq!(prefs.insight_palette.danger, "#C0393B");
}
