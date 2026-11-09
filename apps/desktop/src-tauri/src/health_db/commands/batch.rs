use crate::productivity_db::coordinator::in_transaction;

use super::meal::{create_meal_in_tx, update_meal_in_tx};
use super::super::error::{HealthError, HealthResult};
use super::super::types::{CreateMealRequest, MealSnapshot, UpdateMealRequest};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct HealthAiBatchOp {
    pub create_meal: Option<CreateMealRequest>,
    pub update_meal: Option<UpdateMealRequest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ApplyHealthAiBatchRequest {
    pub ops: Vec<HealthAiBatchOp>,
    #[serde(default)]
    pub expected_data_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyHealthAiBatchResponse {
    pub meals: Vec<MealSnapshot>,
}

fn invalid_patch(msg: impl Into<String>) -> HealthError {
    HealthError::invalid_patch(msg)
}

fn batch_op_kind(op: &HealthAiBatchOp) -> HealthResult<&'static str> {
    let count = [op.create_meal.is_some(), op.update_meal.is_some()]
        .into_iter()
        .filter(|v| *v)
        .count();
    if count != 1 {
        return Err(invalid_patch("batch op must have exactly one change"));
    }
    if op.create_meal.is_some() {
        Ok("createMeal")
    } else {
        Ok("updateMeal")
    }
}

pub fn apply_health_ai_batch(
    data_dir: &str,
    req: ApplyHealthAiBatchRequest,
) -> HealthResult<ApplyHealthAiBatchResponse> {
    if req.ops.is_empty() {
        return Err(invalid_patch("ops must not be empty"));
    }
    if req.expected_data_dir.as_deref().is_some_and(|expected| expected != data_dir) {
        return Err(invalid_patch("数据目录已切换，操作已取消"));
    }

    crate::productivity_db::coordinator::with_write_expected(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let mut meals = Vec::with_capacity(req.ops.len());
            for op in &req.ops {
                let meal = match batch_op_kind(op)? {
                    "createMeal" => create_meal_in_tx(tx, op.create_meal.as_ref().unwrap())?,
                    "updateMeal" => update_meal_in_tx(tx, op.update_meal.as_ref().unwrap())?,
                    _ => return Err(invalid_patch("unsupported batch op").into()),
                };
                meals.push(meal);
            }
            Ok(ApplyHealthAiBatchResponse { meals })
        })
    })
    .map_err(|e| HealthError::new(e.code, e.message))
}
