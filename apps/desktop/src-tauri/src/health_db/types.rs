use serde::{Deserialize, Serialize};
use serde_json::Value;

fn deserialize_present_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MealFoodSnapshot {
    pub id: String,
    pub position: i32,
    pub text: String,
    pub kcal: f64,
    pub kcal_estimated: bool,
    pub serving_text: Option<String>,
    pub serving_estimated: Option<bool>,
    pub carbs_grams: Option<f64>,
    pub protein_grams: Option<f64>,
    pub fat_grams: Option<f64>,
    pub sugar_grams: Option<f64>,
    pub fiber_grams: Option<f64>,
    pub sodium_milligrams: Option<f64>,
    pub vitamin_c_milligrams: Option<f64>,
    pub nutrients_estimated: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedNutrientTotal {
    pub value: f64,
    pub partial: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MealDerivedNutrients {
    pub carbs_grams: Option<DerivedNutrientTotal>,
    pub protein_grams: Option<DerivedNutrientTotal>,
    pub fat_grams: Option<DerivedNutrientTotal>,
    pub sugar_grams: Option<DerivedNutrientTotal>,
    pub fiber_grams: Option<DerivedNutrientTotal>,
    pub sodium_milligrams: Option<DerivedNutrientTotal>,
    pub vitamin_c_milligrams: Option<DerivedNutrientTotal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MealSnapshot {
    pub id: String,
    pub revision: i64,
    pub title: Option<String>,
    pub started_at: String,
    pub slot: Option<String>,
    pub icon_key: Option<String>,
    pub text: Option<String>,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at_hm: Option<String>,
    pub record_shape: String,
    pub foods: Vec<MealFoodSnapshot>,
    pub meal_kcal: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub derived_nutrients: Option<MealDerivedNutrients>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kcal: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub carbs_grams: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protein_grams: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fat_grams: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FoodInput {
    pub text: String,
    pub kcal: f64,
    pub kcal_estimated: bool,
    #[serde(default)]
    pub serving_text: Option<String>,
    pub serving_estimated: Option<bool>,
    #[serde(default)]
    pub carbs_grams: Option<f64>,
    #[serde(default)]
    pub protein_grams: Option<f64>,
    #[serde(default)]
    pub fat_grams: Option<f64>,
    #[serde(default)]
    pub sugar_grams: Option<f64>,
    #[serde(default)]
    pub fiber_grams: Option<f64>,
    #[serde(default)]
    pub sodium_milligrams: Option<f64>,
    #[serde(default)]
    pub vitamin_c_milligrams: Option<f64>,
    pub nutrients_estimated: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMealRequest {
    pub title: String,
    pub started_at: String,
    pub slot: Option<String>,
    #[serde(default)]
    pub icon_key: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub foods: Vec<FoodInput>,
    pub source: Option<String>,
    pub at_hm: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MealRef {
    pub id: String,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMealRequest {
    pub meal: MealRef,
    pub title: String,
    pub started_at: String,
    #[serde(default, deserialize_with = "deserialize_present_option")]
    pub slot: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_present_option")]
    pub icon_key: Option<Option<String>>,
    #[serde(default)]
    pub text: Option<String>,
    pub foods: Vec<FoodInput>,
    pub at_hm: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteMealRequest {
    pub meal: MealRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMealMetadataRequest {
    pub expected_data_dir: String,
    pub meal: MealRef,
    #[serde(default, deserialize_with = "deserialize_present_option")]
    pub title: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_present_option")]
    pub slot: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_present_option")]
    pub icon_key: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_present_option")]
    pub text: Option<Option<String>>,
    #[serde(default)]
    pub update_time: bool,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default, deserialize_with = "deserialize_present_option")]
    pub at_hm: Option<Option<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMealsQuery {
    pub local_date_from: Option<String>,
    pub local_date_to: Option<String>,
    #[serde(default)]
    pub include_deleted: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMealFoodsQuery {
    pub text: String,
    pub local_date_from: Option<String>,
    pub local_date_to: Option<String>,
    pub slot: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MealResponse {
    pub meal: MealSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MealsListResponse {
    pub meals: Vec<MealSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMealFoodsResponse {
    pub meals: Vec<MealSnapshot>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminNormalizedBatch {
    pub run_id: String,
    pub requested_at_utc: String,
    pub local_date_from: String,
    pub local_date_to: String,
    pub parser_version: i32,
    pub entries: Vec<GarminClassEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminClassEntry {
    pub class_id: String,
    pub local_date: String,
    pub external_id: Option<String>,
    pub completeness: String,
    pub content_hash: Option<String>,
    pub parser_version: Option<i32>,
    pub payload: Option<Value>,
    pub error_code: Option<String>,
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminApplyRequest {
    pub entry_point: String,
    pub batch: GarminNormalizedBatch,
}

/// One date × class health write. This is deliberately independent of the legacy batch DTO.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminApplyUnitRequest {
    pub expected_data_dir_key: String,
    pub run_id: String,
    pub job_id: String,
    pub work_item_id: String,
    pub attempt_generation: i64,
    pub expected_attempt_count: i64,
    pub entry: GarminClassEntry,
    pub result_code: String,
    pub error_code: Option<String>,
    #[serde(default)]
    pub pause_state: Option<String>,
    #[serde(default)]
    pub pause_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminApplyUnitResponse {
    pub job_id: String,
    pub work_item_id: String,
    pub result_code: String,
    pub outcome: String,
    pub content_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminClassCoverageEntry {
    pub class_id: String,
    pub local_date: String,
    pub external_id: Option<String>,
    pub outcome: String,
    pub submitted_root_ids: Vec<String>,
    pub error_code: Option<String>,
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminApplyResult {
    pub run_id: String,
    pub overall_status: String,
    pub submitted_class_count: u32,
    pub skipped_same_hash_count: u32,
    pub retained_gap_count: u32,
    pub changed_roots: Vec<Value>,
    pub coverage: Vec<GarminClassCoverageEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityAssetSnapshot {
    pub kind: String,
    pub status: String,
    pub relative_path: Option<String>,
    pub sha256: Option<String>,
    pub acquired_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityListItem {
    pub id: String,
    pub revision: i64,
    pub local_date: String,
    pub source: String,
    pub garmin_activity_id: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub type_key: Option<String>,
    pub title: Option<String>,
    pub duration_seconds: Option<f64>,
    pub elapsed_duration_seconds: Option<f64>,
    pub moving_duration_seconds: Option<f64>,
    pub distance_meters: Option<f64>,
    pub elevation_gain_meters: Option<f64>,
    pub avg_heart_rate_bpm: Option<f64>,
    pub avg_speed_mps: Option<f64>,
    pub avg_pace_seconds_per_km: Option<f64>,
    pub avg_power_watts: Option<f64>,
    pub calories: Option<f64>,
    pub detail_status: Option<String>,
    pub suspected_duplicate_of: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityDetailResponse {
    pub activity: ActivityListItem,
    pub assets: Vec<ActivityAssetSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitiesListResponse {
    pub activities: Vec<ActivityListItem>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListActivitiesQuery {
    pub local_date_from: Option<String>,
    pub local_date_to: Option<String>,
    #[serde(default = "default_activity_limit")]
    pub limit: u32,
    #[serde(default)]
    pub offset: u32,
}

fn default_activity_limit() -> u32 {
    200
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadActivityAssetRequest {
    pub activity_id: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadActivityAssetResponse {
    pub kind: String,
    pub relative_path: String,
    pub sha256: String,
    pub bytes_base64: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryOriginalDownloadRequest {
    pub activity_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFitFromZipRequest {
    pub activity_id: String,
    pub output_path: String,
}
