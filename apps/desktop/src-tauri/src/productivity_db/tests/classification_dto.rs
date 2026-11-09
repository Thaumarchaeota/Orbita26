use serde_json::json;

use crate::productivity_db::{parse_request, types::{CreateItemRequest, ItemPatch}};

#[test]
fn item_patch_preserves_omitted_vs_explicit_clear_for_item_type_and_tags() {
    let omitted: ItemPatch = parse_request(json!({})).expect("empty patch");
    assert_eq!(omitted.item_type_id, None);
    assert_eq!(omitted.tag_ids, None);

    let clear_type: ItemPatch = parse_request(json!({ "itemTypeId": null })).expect("clear type");
    assert_eq!(clear_type.item_type_id, Some(None));

    let clear_tags: ItemPatch = parse_request(json!({ "tagIds": [] })).expect("clear tags");
    assert_eq!(clear_tags.tag_ids, Some(vec![]));

    assert!(parse_request::<ItemPatch>(json!({ "tagIds": null })).is_err());
}

#[test]
fn item_create_defaults_missing_classifications_to_unclassified() {
    let item: CreateItemRequest = parse_request(json!({
        "title": "legacy-compatible",
        "description": null,
        "status": "进行中",
        "listId": null,
        "plannedPoint": null,
        "duePoint": null
    })).expect("create without classifications");

    assert_eq!(item.item_type_id, None);
    assert!(item.tag_ids.is_empty());
    assert!(item.classification_expected.is_none());
}

#[test]
fn item_create_rejects_null_or_repeated_tag_id_array_shape_at_validation_boundary() {
    let null_tags = json!({
        "title": "bad",
        "description": null,
        "status": "进行中",
        "listId": null,
        "plannedPoint": null,
        "duePoint": null,
        "tagIds": null
    });
    assert!(parse_request::<CreateItemRequest>(null_tags).is_err());

    // Duplicate IDs are syntactically valid JSON and must be rejected by the domain command.
    // Keep this parser assertion deliberately permissive so validation remains tested at its
    // transaction boundary in classification_items.rs.
    let repeated = json!({
        "title": "repeated",
        "description": null,
        "status": "进行中",
        "listId": null,
        "plannedPoint": null,
        "duePoint": null,
        "tagIds": ["tag-a", "tag-a"]
    });
    let item: CreateItemRequest = parse_request(repeated).expect("well-shaped repeated IDs");
    assert_eq!(item.tag_ids, ["tag-a", "tag-a"]);
}
