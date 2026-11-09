// ItemType, Tag and Item association invariants share Archive transactions; see SPEC-0003 §12.6.
use std::collections::{HashMap, HashSet};
use rusqlite::{params, OptionalExtension, Transaction};
use super::error::{DomainError, DomainResult};
use super::repository::{guard_unknown, item_snapshot};
use super::types::*;

fn name_value(name: &str) -> DomainResult<(String, String)> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() { return Err(DomainError::invalid_patch("classification name required")); }
    let key = trimmed.chars().map(|c| if c.is_ascii_uppercase() { c.to_ascii_lowercase() } else { c }).collect();
    Ok((trimmed, key))
}

fn color_value(color: Option<&str>) -> DomainResult<Option<String>> {
    match color {
        None => Ok(None),
        Some(c) if c.len() == 7 && c.starts_with('#') && c[1..].bytes().all(|b| b.is_ascii_hexdigit()) => Ok(Some(c.to_ascii_uppercase())),
        Some(_) => Err(DomainError::invalid_patch("color must be #RRGGBB")),
    }
}

pub(crate) fn catalog_ref(tx: &Transaction, expected: &RevisionRef) -> DomainResult<()> {
    let row: Option<(i64, String)> = tx.query_row(
        "SELECT revision, extra_json FROM productivity_item_type_catalog WHERE id = ?1 AND deleted_at_utc IS NULL",
        [&expected.id], |r| Ok((r.get(0)?, r.get(1)?)),
    ).optional()?;
    let (revision, extra) = row.ok_or_else(|| DomainError::root_not_found("catalog not found"))?;
    let _ = extra;
    if revision != expected.expected_revision { return Err(DomainError::revision_conflict("catalog revision differs")); }
    Ok(())
}

pub(crate) fn catalog_snapshot(tx: &Transaction) -> DomainResult<Option<ItemTypeCatalogSnapshot>> {
    let root: Option<(String, i64, String, String, Option<String>, String)> = tx.query_row(
        "SELECT id, revision, created_at_utc, updated_at_utc, deleted_at_utc, extra_json FROM productivity_item_type_catalog LIMIT 1",
        [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
    ).optional()?;
    let Some((id, revision, created_at_utc, updated_at_utc, deleted_at_utc, extra)) = root else { return Ok(None); };
    let _ = extra;
    let mut stmt = tx.prepare("SELECT id, name, parent_item_type_id, color_override, inactive, created_at_utc, updated_at_utc, extra_json, system_role FROM productivity_item_type ORDER BY created_at_utc, id")?;
    let raw = stmt.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,bool>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?,r.get::<_,String>(7)?,r.get::<_,Option<String>>(8)?)))?.collect::<Result<Vec<_>,_>>()?;
    let by_id: HashMap<String, usize> = raw.iter().enumerate().map(|(i,n)| (n.0.clone(),i)).collect();
    let mut nodes = Vec::new();
    for n in &raw {
        let mut color = n.3.clone();
        let mut inactive = n.4;
        let mut parent = n.2.clone();
        let mut seen = HashSet::new();
        seen.insert(n.0.clone());
        while let Some(pid) = parent {
            if !seen.insert(pid.clone()) { return Err(DomainError::tree_cycle()); }
            let p = &raw[*by_id.get(&pid).ok_or_else(|| DomainError::archive_lifecycle("missing ItemType parent"))?];
            if color.is_none() { color = p.3.clone(); }
            inactive |= p.4;
            parent = p.2.clone();
        }
        let reference_count = live_item_type_references(tx, &n.0)?;
        let child_count: i64 = tx.query_row("SELECT COUNT(*) FROM productivity_item_type WHERE parent_item_type_id=?1", [&n.0], |r| r.get(0))?;
        let can_delete = n.8.is_none() && reference_count == 0 && child_count == 0;
        nodes.push(ItemTypeSnapshot { id:n.0.clone(), name:n.1.clone(), parent_item_type_id:n.2.clone(), color_override:n.3.clone(), effective_color:color.ok_or_else(|| DomainError::archive_lifecycle("ItemType has no root color"))?, inactive:n.4, effective_inactive:inactive, created_at_utc:n.5.clone(), updated_at_utc:n.6.clone(), reference_count, child_count, can_delete, system_role:n.8.clone() });
    }
    Ok(Some(ItemTypeCatalogSnapshot { id, revision, item_types:nodes, created_at_utc, updated_at_utc, deleted_at_utc }))
}

pub(crate) fn tag_snapshot(tx: &Transaction, id: &str, live_only: bool) -> DomainResult<TagSnapshot> {
    let row = tx.query_row("SELECT revision,name,inactive,created_at_utc,updated_at_utc,deleted_at_utc,extra_json FROM productivity_tag WHERE id = ?1", [id], |r| Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,bool>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,String>(6)?))).optional()?;
    let Some((revision,name,inactive,created_at_utc,updated_at_utc,deleted_at_utc,extra)) = row else { return Err(DomainError::root_not_found("tag not found")); };
    if live_only && deleted_at_utc.is_some() { return Err(DomainError::root_deleted("tag deleted")); }
    let _ = extra;
    Ok(TagSnapshot { id:id.to_string(), revision,name,inactive,created_at_utc,updated_at_utc,deleted_at_utc })
}

pub(crate) fn tag_ref(tx: &Transaction, expected: &RevisionRef) -> DomainResult<TagSnapshot> {
    let tag = tag_snapshot(tx, &expected.id, true)?;
    if tag.revision != expected.expected_revision { return Err(DomainError::revision_conflict("tag revision differs")); }
    Ok(tag)
}

fn unique_name(tx: &Transaction, table: &str, key: &str, self_id: Option<&str>) -> DomainResult<()> {
    let sql = match table { "type" => "SELECT id FROM productivity_item_type WHERE name_key = ?1", _ => "SELECT id FROM productivity_tag WHERE name_key = ?1" };
    let found: Option<String> = tx.query_row(sql, [key], |r| r.get(0)).optional()?;
    if found.as_deref().is_some_and(|id| Some(id) != self_id) { return Err(DomainError::invalid_patch("classification name already exists")); }
    Ok(())
}

pub(crate) fn classification_for_item(tx: &Transaction, item_id: Option<&str>, item_type_id: Option<&str>, tag_ids: &[String], expected: Option<&ClassificationExpected>) -> DomainResult<()> {
    if let Some(id)=item_type_id {
        let role:Option<String>=tx.query_row("SELECT system_role FROM productivity_item_type WHERE id=?1",[id],|r|r.get(0)).optional()?.flatten();
        if matches!(role.as_deref(),Some("sleep"|"activity"|"meal")){return Err(DomainError::invalid_patch("health classification requires its dedicated plan command; meal is color-only"));}
    }
    let mut seen = HashSet::new();
    if tag_ids.iter().any(|id| !seen.insert(id)) { return Err(DomainError::invalid_patch("duplicate tag id")); }
    let old_type: Option<String> = if let Some(id) = item_id { tx.query_row("SELECT item_type_id FROM productivity_item WHERE id = ?1", [id], |r| r.get(0))? } else { None };
    let old_tags: HashSet<String> = if let Some(id) = item_id {
        let mut s = tx.prepare("SELECT tag_id FROM productivity_item_tag WHERE item_id = ?1")?;
        let rows = s.query_map([id], |r| r.get(0))?;
        let collected = rows.collect::<Result<HashSet<_>,_>>()?;
        collected
    } else { HashSet::new() };
    if let Some(exp) = expected {
        if let Some(c) = &exp.item_type_catalog { catalog_ref(tx,c)?; }
        let mut refs = HashSet::new();
        for r in &exp.tags { if !refs.insert(&r.id) { return Err(DomainError::invalid_patch("duplicate tag revision")); } tag_ref(tx,r)?; }
    }
    if let Some(type_id) = item_type_id {
        if old_type.as_deref() != Some(type_id) {
            let c = expected.and_then(|e| e.item_type_catalog.as_ref()).ok_or_else(|| DomainError::invalid_patch("catalog expectedRevision required"))?;
            catalog_ref(tx,c)?;
            let catalog = catalog_snapshot(tx)?.ok_or_else(|| DomainError::root_not_found("catalog not found"))?;
            let node = catalog.item_types.iter().find(|n| n.id == type_id).ok_or_else(|| DomainError::root_not_found("ItemType not found"))?;
            if node.effective_inactive { return Err(DomainError::new("CLASSIFICATION_INACTIVE", "ItemType is inactive")); }
        }
    }
    for id in tag_ids {
        if !old_tags.contains(id) {
            let r = expected.and_then(|e| e.tags.iter().find(|r| r.id == *id)).ok_or_else(|| DomainError::invalid_patch("tag expectedRevision required"))?;
            let tag = tag_ref(tx,r)?;
            if tag.inactive { return Err(DomainError::new("CLASSIFICATION_INACTIVE", "tag is inactive")); }
        }
    }
    Ok(())
}

pub(crate) fn set_task_classification(tx: &Transaction, task_id: &str, target: Option<&str>, expected: Option<&ClassificationExpected>) -> DomainResult<()> {
    let old: Option<String> = tx.query_row("SELECT item_type_id FROM productivity_task WHERE id=?1", [task_id], |r| r.get(0))?;
    if old.as_deref() == target { return Ok(()); }
    if let Some(id) = target {
        let reference = expected.and_then(|e| e.item_type_catalog.as_ref()).ok_or_else(|| DomainError::invalid_patch("catalog expectedRevision required"))?;
        catalog_ref(tx, reference)?;
        let catalog = catalog_snapshot(tx)?.ok_or_else(|| DomainError::root_not_found("catalog not found"))?;
        let node = catalog.item_types.iter().find(|n| n.id == id).ok_or_else(|| DomainError::root_not_found("ItemType not found"))?;
        if matches!(node.system_role.as_deref(), Some("sleep" | "activity" | "meal")) { return Err(DomainError::invalid_patch("health classification requires its dedicated plan command; meal is color-only")); }
        if node.effective_inactive { return Err(DomainError::new("CLASSIFICATION_INACTIVE", "ItemType is inactive")); }
    }
    tx.execute("UPDATE productivity_task SET item_type_id=?1 WHERE id=?2", params![target, task_id])?;
    Ok(())
}

pub(crate) fn write_item_classification(tx: &Transaction, item_id: &str, item_type_id: Option<&str>, tag_ids: &[String]) -> DomainResult<()> {
    tx.execute("UPDATE productivity_item SET item_type_id = ?1 WHERE id = ?2", params![item_type_id,item_id])?;
    tx.execute("DELETE FROM productivity_item_tag WHERE item_id = ?1", [item_id])?;
    for tag in tag_ids { tx.execute("INSERT INTO productivity_item_tag(item_id,tag_id) VALUES (?1,?2)", params![item_id,tag])?; }
    Ok(())
}

pub(crate) fn create_item_classification(tx: &Transaction, item_id: &str, item_type_id: Option<&str>, tag_ids: &[String], expected: Option<&ClassificationExpected>) -> DomainResult<()> {
    if let Some(id) = item_type_id {
        let role: Option<String> = tx.query_row("SELECT system_role FROM productivity_item_type WHERE id=?1", [id], |r|r.get(0)).optional()?.flatten();
        if matches!(role.as_deref(),Some("sleep"|"activity"|"meal")) { return Err(DomainError::invalid_patch("use health plan creation; meal is color-only")); }
    }
    classification_for_item(tx,None,item_type_id,tag_ids,expected)?;
    write_item_classification(tx,item_id,item_type_id,tag_ids)
}

pub(crate) fn apply_item_patch_classification(tx: &Transaction, item_id: &str, patch: &ItemPatch) -> DomainResult<bool> {
    super::health_plan::guard_item(tx,item_id)?;
    if let Some(Some(id)) = &patch.item_type_id {
        let role: Option<String> = tx.query_row("SELECT system_role FROM productivity_item_type WHERE id=?1", [id], |r|r.get(0)).optional()?.flatten();
        if matches!(role.as_deref(),Some("sleep"|"activity"|"meal")) {return Err(DomainError::invalid_patch("use health plan creation; meal is color-only"));}
    }
    let is_trip: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM productivity_item_travel_detail WHERE item_id=?1)", [item_id], |r| r.get(0)).unwrap_or(false);
    if is_trip && (patch.item_type_id.is_some() || patch.classification_expected.is_some()) {
        return Err(DomainError::invalid_patch("travel item classification is immutable"));
    }
    let old_type:Option<String>=tx.query_row("SELECT item_type_id FROM productivity_item WHERE id=?1",[item_id],|r|r.get(0))?;
    let mut stmt=tx.prepare("SELECT tag_id FROM productivity_item_tag WHERE item_id=?1 ORDER BY tag_id")?;
    let old_tags=stmt.query_map([item_id],|r|r.get::<_,String>(0))?.collect::<Result<Vec<_>,_>>()?;
    let target_type=patch.item_type_id.as_ref().map(|v|v.clone()).unwrap_or(old_type.clone());
    let target_tags=patch.tag_ids.as_ref().unwrap_or(&old_tags);
    classification_for_item(tx,Some(item_id),target_type.as_deref(),target_tags,patch.classification_expected.as_ref())?;
    let changed = target_type != old_type || target_tags.iter().collect::<HashSet<_>>() != old_tags.iter().collect::<HashSet<_>>();
    if changed { write_item_classification(tx,item_id,target_type.as_deref(),target_tags)?; }
    Ok(changed)
}

pub fn get_catalog(data_dir: &str) -> DomainResult<ItemTypeCatalogResponse> {
    super::coordinator::with_read(data_dir, |conn| match conn {
        None => Ok(ItemTypeCatalogResponse { catalog: None }),
        Some(conn) => super::coordinator::in_transaction(conn, |tx| Ok(ItemTypeCatalogResponse { catalog: catalog_snapshot(tx)? })),
    })
}

fn with_catalog_write<T>(data_dir: &str, f: impl FnOnce(&Transaction) -> DomainResult<T>) -> DomainResult<T> {
    super::coordinator::with_write(data_dir, |conn| super::coordinator::in_transaction(conn, f))
}

/// Saves the complete no-delete/no-move category draft as one Catalog aggregate write.
/// SPEC-0003 §12.6 requires one transaction and one Catalog revision for the whole tree.
pub fn save_item_type_catalog(data_dir: &str, req: SaveItemTypeCatalogRequest) -> DomainResult<ItemTypeCatalogResponse> {
    if req.nodes.is_empty() { return Err(DomainError::invalid_patch("catalog must contain at least one ItemType")); }
    let mut normalized = Vec::with_capacity(req.nodes.len());
    let mut ids = HashSet::new();
    for mut node in req.nodes {
        let parsed = uuid::Uuid::parse_str(&node.id).map_err(|_| DomainError::invalid_patch("ItemType id must be a UUID"))?;
        node.id = parsed.to_string();
        if !ids.insert(node.id.clone()) { return Err(DomainError::invalid_patch("duplicate ItemType id")); }
        if let Some(parent) = node.parent_item_type_id.as_mut() {
            let parsed = uuid::Uuid::parse_str(parent).map_err(|_| DomainError::invalid_patch("parentItemTypeId must be a UUID"))?;
            *parent = parsed.to_string();
        }
        let (name, key) = name_value(&node.name)?;
        let color = color_value(node.color_override.as_deref())?;
        if node.parent_item_type_id.is_none() && color.is_none() { return Err(DomainError::invalid_patch("root ItemType color required")); }
        normalized.push((node.id, name, key, node.parent_item_type_id, color, node.inactive));
    }
    let mut names = HashSet::new();
    if normalized.iter().any(|n| !names.insert(n.2.clone())) { return Err(DomainError::invalid_patch("classification name already exists")); }

    // Expected-root coordinator locking closes the dataDir A→B race after the host check.
    super::coordinator::with_write_expected(data_dir, |conn| super::coordinator::in_transaction(conn, |tx| {
        let current = catalog_snapshot(tx)?;
        match (&current, &req.catalog) {
            (Some(c), Some(expected)) => {
                if c.id != expected.id || c.revision != expected.expected_revision { return Err(DomainError::revision_conflict("catalog revision differs")); }
            }
            (Some(_), None) => return Err(DomainError::revision_conflict("catalog was created or updated elsewhere")),
            (None, Some(_)) => return Err(DomainError::root_not_found("catalog not found")),
            (None, None) => {}
        }
        if let Some(expected) = &req.catalog {
            let _ = catalog_guard(tx, expected)?;
        } else if current.is_some() {
            return Err(DomainError::revision_conflict("catalog was created or updated elsewhere"));
        }

        let mut old = HashMap::<String, ItemTypeSnapshot>::new();
        if let Some(catalog) = &current {
            old.extend(catalog.item_types.iter().cloned().map(|n| (uuid::Uuid::parse_str(&n.id).map(|u| u.to_string()).unwrap_or_else(|_| n.id.clone()), n)));
        }
        for (id, name, key, parent, color, inactive) in &normalized {
            if let Some(previous) = old.get(id) {
                let previous_parent = previous.parent_item_type_id.as_deref().map(|p| uuid::Uuid::parse_str(p).map(|u|u.to_string()).unwrap_or_else(|_|p.to_string()));
                if previous_parent.as_deref() != parent.as_deref() {
                    return Err(DomainError::invalid_patch("existing ItemType parent cannot change"));
                }
                let _ = (name, key, color, inactive);
            } else {
                let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM productivity_item_type WHERE id=?1)", [id], |r| r.get(0))?;
                if exists { return Err(DomainError::invalid_patch("new ItemType id already exists")); }
            }
        }
        if old.keys().any(|id| !ids.contains(id)) { return Err(DomainError::invalid_patch("existing ItemTypes cannot be removed")); }
        let by_id: HashMap<&str, &(String,String,String,Option<String>,Option<String>,bool)> = normalized.iter().map(|n|(n.0.as_str(),n)).collect();
        for (id, _, _, parent, _, _) in &normalized {
            let mut cursor = parent.as_deref();
            let mut seen = HashSet::from([id.as_str()]);
            while let Some(parent_id) = cursor {
                if !seen.insert(parent_id) { return Err(DomainError::tree_cycle()); }
                cursor = by_id.get(parent_id).ok_or_else(|| DomainError::invalid_patch("parent ItemType does not exist"))?.3.as_deref();
            }
        }
        let changed = normalized.iter().any(|n| old.get(&n.0).map_or(true, |prev| prev.name != n.1 || prev.color_override != n.4 || prev.inactive != n.5));
        if !changed { return Ok(ItemTypeCatalogResponse { catalog: current }); }

        let now = super::util::utc_now();
        let catalog_id = if let Some(catalog) = &current { catalog.id.clone() } else {
            let id = super::util::new_uuid();
            tx.execute("INSERT INTO productivity_item_type_catalog(id,revision,created_at_utc,updated_at_utc) VALUES (?1,0,?2,?2)", params![id,now])?;
            id
        };

        // Stage changed unique keys so valid A↔B name swaps fit SQLite's immediate UNIQUE constraint.
        // Matching normalizes UUIDs, but migrated rows may keep compact IDs; write through the stored ID (docs/plans/travel-transportation-mvp-cursor-handoff.md §13).
        for n in &normalized {
            let previous = old.get(&n.0);
            let persisted_id = previous.map(|node| node.id.as_str()).unwrap_or(n.0.as_str());
            let role: Option<String> = tx.query_row("SELECT system_role FROM productivity_item_type WHERE id=?1", [persisted_id], |r| r.get(0)).optional()?.flatten();
            if role.is_some() && old.get(&n.0).is_some_and(|p| p.name != n.1 || n.5) {
                return Err(DomainError::invalid_patch("system travel preset bulk update only permits color"));
            }
            if let Some(previous) = previous {
                if previous.name != n.1 {
                    let staged = format!("__catalog_stage_{}", uuid::Uuid::new_v4());
                    let changed = tx.execute("UPDATE productivity_item_type SET name_key=?1 WHERE id=?2", params![staged,previous.id])?;
                    if changed != 1 { return Err(DomainError::root_not_found("ItemType not found")); }
                }
            }
        }
        for n in &normalized {
            if let Some(previous) = old.get(&n.0) {
                if previous.name != n.1 || previous.color_override != n.4 || previous.inactive != n.5 {
                    let changed = tx.execute("UPDATE productivity_item_type SET name=?1,name_key=?2,color_override=?3,inactive=?4,updated_at_utc=?5 WHERE id=?6", params![n.1,n.2,n.4,n.5,now,previous.id])?;
                    if changed != 1 { return Err(DomainError::root_not_found("ItemType not found")); }
                }
            }
        }
        let mut pending: HashSet<String> = normalized.iter().filter(|n| !old.contains_key(&n.0)).map(|n| n.0.clone()).collect();
        while !pending.is_empty() {
            let ready = normalized.iter().find(|n| pending.contains(&n.0) && n.3.as_ref().map_or(true, |p| !pending.contains(p))).ok_or_else(DomainError::tree_cycle)?;
            tx.execute("INSERT INTO productivity_item_type(id,catalog_id,parent_item_type_id,name,name_key,color_override,inactive,created_at_utc,updated_at_utc) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)", params![ready.0,catalog_id,ready.3,ready.1,ready.2,ready.4,ready.5,now])?;
            pending.remove(&ready.0);
        }
        bump_catalog(tx,&catalog_id,&now)?;
        Ok(ItemTypeCatalogResponse { catalog: catalog_snapshot(tx)? })
    }))
}

/// Physical deletion is limited to childless, non-system nodes with no live Item.
/// Tombstoned Items keep the type until this command; they are cleared to unassigned
/// in the same transaction so restore does not point at a missing node.
pub fn delete_item_type(data_dir: &str, req: DeleteItemTypeRequest) -> DomainResult<ItemTypeCatalogResponse> {
    super::coordinator::with_write_expected(&req.expected_data_dir, |conn| super::coordinator::in_transaction(conn, |tx| {
        let catalog = catalog_guard(tx, &req.catalog)?;
        let node = catalog.item_types.iter().find(|n| n.id == req.item_type_id)
            .ok_or_else(|| DomainError::root_not_found("ItemType not found"))?;
        if node.system_role.is_some() { return Err(DomainError::invalid_patch("system ItemType cannot be deleted")); }
        if node.child_count > 0 { return Err(DomainError::new("CLASSIFICATION_HAS_CHILDREN", "ItemType has child categories")); }
        let live = live_item_type_references(tx, &node.id)?;
        if live > 0 { return Err(DomainError::new("CLASSIFICATION_REFERENCED", "ItemType is referenced by live Items or Tasks")); }
        // Physical deletion is destructive, so unknown fields on the target block it.
        let extra: String = tx.query_row("SELECT extra_json FROM productivity_item_type WHERE id=?1", [&node.id], |r| r.get(0))?;
        guard_unknown(&extra)?;
        let mut affected = tx.prepare("SELECT DISTINCT project_id FROM productivity_task WHERE item_type_id=?1 AND deleted_at_utc IS NOT NULL")?;
        let projects = affected.query_map([&node.id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        drop(affected);
        for project in &projects {
            let (_, extra) = super::repository::load_project_row(tx, project, false)?;
            guard_unknown(&extra)?;
            super::repository::guard_project_members(tx, project)?;
        }
        let now = super::util::utc_now();
        tx.execute("UPDATE productivity_task SET item_type_id=NULL, updated_at_utc=?1 WHERE item_type_id=?2 AND deleted_at_utc IS NOT NULL", params![now, node.id])?;
        for project in &projects { super::repository::bump_project(tx, project, &now)?; }
        tx.execute(
            "UPDATE productivity_item SET item_type_id = NULL, updated_at_utc = ?1, revision = revision + 1 WHERE item_type_id = ?2 AND deleted_at_utc IS NOT NULL",
            params![now, node.id],
        )?;
        let changed = tx.execute("DELETE FROM productivity_item_type WHERE id=?1", [&node.id])?;
        if changed != 1 { return Err(DomainError::root_not_found("ItemType not found")); }
        bump_catalog(tx, &catalog.id, &now)?;
        Ok(ItemTypeCatalogResponse { catalog: catalog_snapshot(tx)? })
    }))
}

fn live_item_type_references(tx: &Transaction, item_type_id: &str) -> DomainResult<i64> {
    Ok(tx.query_row(
        "SELECT (SELECT COUNT(*) FROM productivity_item WHERE item_type_id=?1 AND deleted_at_utc IS NULL) + (SELECT COUNT(*) FROM productivity_task WHERE item_type_id=?1 AND deleted_at_utc IS NULL)",
        [item_type_id],
        |r| r.get(0),
    )?)
}

fn catalog_guard(tx: &Transaction, expected: &RevisionRef) -> DomainResult<ItemTypeCatalogSnapshot> {
    catalog_ref(tx, expected)?;
    let root_extra:String=tx.query_row("SELECT extra_json FROM productivity_item_type_catalog WHERE id=?1",[&expected.id],|r|r.get(0))?;
    guard_unknown(&root_extra)?;
    let mut stmt=tx.prepare("SELECT extra_json FROM productivity_item_type")?;
    for extra in stmt.query_map([],|r|r.get::<_,String>(0))? { guard_unknown(&extra?)?; }
    catalog_snapshot(tx)?.ok_or_else(|| DomainError::root_not_found("catalog not found"))
}

pub(crate) fn bump_catalog(tx: &Transaction, id: &str, now: &str) -> DomainResult<()> {
    tx.execute("UPDATE productivity_item_type_catalog SET revision=revision+1, updated_at_utc=?1 WHERE id=?2", params![now,id])?;
    Ok(())
}

pub fn create_item_type(data_dir: &str, req: CreateItemTypeRequest) -> DomainResult<ItemTypeCatalogResponse> {
    let (name,key) = name_value(&req.name)?;
    let color = color_value(req.color_override.as_deref())?;
    with_catalog_write(data_dir, |tx| {
        let existing = catalog_snapshot(tx)?;
        let now = super::util::utc_now();
        let catalog_id = match (existing, &req.catalog) {
            (None,None) => {
                let id = super::util::new_uuid();
                tx.execute("INSERT INTO productivity_item_type_catalog(id,revision,created_at_utc,updated_at_utc) VALUES (?1,0,?2,?2)", params![id,now])?;
                id
            }
            (Some(_),Some(reference)) => { catalog_guard(tx,reference)?; reference.id.clone() }
            (None,Some(_)) => return Err(DomainError::root_not_found("catalog not found")),
            (Some(_),None) => return Err(DomainError::invalid_patch("catalog expectedRevision required")),
        };
        if let Some(parent) = &req.parent_item_type_id {
            let c = catalog_snapshot(tx)?.unwrap();
            if !c.item_types.iter().any(|n| &n.id == parent) { return Err(DomainError::root_not_found("parent ItemType not found")); }
        } else if color.is_none() { return Err(DomainError::invalid_patch("root ItemType color required")); }
        unique_name(tx,"type",&key,None)?;
        let id = super::util::new_uuid();
        tx.execute("INSERT INTO productivity_item_type(id,catalog_id,parent_item_type_id,name,name_key,color_override,inactive,created_at_utc,updated_at_utc) VALUES (?1,?2,?3,?4,?5,?6,0,?7,?7)", params![id,catalog_id,req.parent_item_type_id,name,key,color,now])?;
        bump_catalog(tx,&catalog_id,&now)?;
        Ok(ItemTypeCatalogResponse { catalog: catalog_snapshot(tx)? })
    })
}

pub fn update_item_type(data_dir: &str, req: UpdateItemTypeRequest) -> DomainResult<ItemTypeCatalogResponse> {
    with_catalog_write(data_dir, |tx| {
        let catalog = catalog_guard(tx,&req.catalog)?;
        let node = catalog.item_types.iter().find(|n| n.id==req.item_type_id).ok_or_else(|| DomainError::root_not_found("ItemType not found"))?;
        if node.system_role.is_some() && req.name.is_some() { return Err(DomainError::invalid_patch("system travel preset only permits color changes")); }
        let (name,key) = name_value(req.name.as_deref().unwrap_or(&node.name))?;
        unique_name(tx,"type",&key,Some(&node.id))?;
        let color = match &req.color_override { Some(v) => color_value(v.as_deref())?, None => node.color_override.clone() };
        if node.parent_item_type_id.is_none() && color.is_none() { return Err(DomainError::invalid_patch("root ItemType color required")); }
        if name==node.name && color==node.color_override { return Ok(ItemTypeCatalogResponse { catalog:Some(catalog) }); }
        let now = super::util::utc_now();
        tx.execute("UPDATE productivity_item_type SET name=?1,name_key=?2,color_override=?3,updated_at_utc=?4 WHERE id=?5",params![name,key,color,now,node.id])?;
        bump_catalog(tx,&catalog.id,&now)?;
        Ok(ItemTypeCatalogResponse { catalog: catalog_snapshot(tx)? })
    })
}

pub fn move_item_type(data_dir: &str, req: MoveItemTypeRequest) -> DomainResult<ItemTypeCatalogResponse> {
    with_catalog_write(data_dir, |tx| {
        let catalog = catalog_guard(tx,&req.catalog)?;
        let node = catalog.item_types.iter().find(|n| n.id==req.item_type_id).ok_or_else(|| DomainError::root_not_found("ItemType not found"))?;
        if node.system_role.is_some() { return Err(DomainError::invalid_patch("system travel preset cannot be moved")); }
        if req.parent_item_type_id.as_deref()==Some(node.id.as_str()) { return Err(DomainError::tree_cycle()); }
        if let Some(parent) = &req.parent_item_type_id {
            let mut current=Some(parent.as_str());
            let mut seen=HashSet::new();
            while let Some(id)=current {
                if id==node.id || !seen.insert(id) { return Err(DomainError::tree_cycle()); }
                let p=catalog.item_types.iter().find(|n| n.id==id).ok_or_else(|| DomainError::root_not_found("parent ItemType not found"))?;
                current=p.parent_item_type_id.as_deref();
            }
        }
        let color=match &req.color_override { Some(v)=>color_value(v.as_deref())?,None=>node.color_override.clone() };
        if req.parent_item_type_id.is_none() && color.is_none() { return Err(DomainError::invalid_patch("root ItemType color required")); }
        if req.parent_item_type_id==node.parent_item_type_id && color==node.color_override { return Ok(ItemTypeCatalogResponse { catalog:Some(catalog) }); }
        let now=super::util::utc_now();
        tx.execute("UPDATE productivity_item_type SET parent_item_type_id=?1,color_override=?2,updated_at_utc=?3 WHERE id=?4",params![req.parent_item_type_id,color,now,node.id])?;
        bump_catalog(tx,&catalog.id,&now)?;
        Ok(ItemTypeCatalogResponse { catalog:catalog_snapshot(tx)? })
    })
}

pub fn set_item_type_inactive(data_dir: &str, req: SetItemTypeInactiveRequest) -> DomainResult<ItemTypeCatalogResponse> {
    with_catalog_write(data_dir, |tx| {
        let catalog=catalog_guard(tx,&req.catalog)?;
        let node=catalog.item_types.iter().find(|n| n.id==req.item_type_id).ok_or_else(|| DomainError::root_not_found("ItemType not found"))?;
        if node.system_role.is_some() { return Err(DomainError::invalid_patch("system travel preset cannot be disabled")); }
        if node.inactive==req.inactive { return Ok(ItemTypeCatalogResponse { catalog:Some(catalog) }); }
        let now=super::util::utc_now();
        tx.execute("UPDATE productivity_item_type SET inactive=?1,updated_at_utc=?2 WHERE id=?3",params![req.inactive,now,req.item_type_id])?;
        bump_catalog(tx,&catalog.id,&now)?;
        Ok(ItemTypeCatalogResponse { catalog:catalog_snapshot(tx)? })
    })
}

pub fn create_tag(data_dir: &str, req: CreateTagRequest) -> DomainResult<TagResponse> {
    let (name,key)=name_value(&req.name)?;
    with_catalog_write(data_dir, |tx| {
        unique_name(tx,"tag",&key,None)?;
        let id=super::util::new_uuid(); let now=super::util::utc_now();
        tx.execute("INSERT INTO productivity_tag(id,revision,name,name_key,inactive,created_at_utc,updated_at_utc) VALUES (?1,1,?2,?3,0,?4,?4)",params![id,name,key,now])?;
        Ok(TagResponse { tag:tag_snapshot(tx,&id,true)? })
    })
}

pub fn update_tag(data_dir: &str, req: UpdateTagRequest) -> DomainResult<TagResponse> {
    let (name,key)=name_value(&req.name)?;
    with_catalog_write(data_dir, |tx| {
        let old=tag_ref(tx,&req.tag)?; let extra:String=tx.query_row("SELECT extra_json FROM productivity_tag WHERE id=?1",[&req.tag.id],|r|r.get(0))?; guard_unknown(&extra)?; unique_name(tx,"tag",&key,Some(&req.tag.id))?;
        if old.name==name { return Ok(TagResponse { tag:old }); }
        let now=super::util::utc_now();
        tx.execute("UPDATE productivity_tag SET name=?1,name_key=?2,revision=revision+1,updated_at_utc=?3 WHERE id=?4",params![name,key,now,req.tag.id])?;
        Ok(TagResponse { tag:tag_snapshot(tx,&req.tag.id,true)? })
    })
}

pub fn set_tag_inactive(data_dir: &str, req: SetTagInactiveRequest) -> DomainResult<TagResponse> {
    with_catalog_write(data_dir, |tx| {
        let old=tag_ref(tx,&req.tag)?; let extra:String=tx.query_row("SELECT extra_json FROM productivity_tag WHERE id=?1",[&req.tag.id],|r|r.get(0))?; guard_unknown(&extra)?;
        if old.inactive==req.inactive { return Ok(TagResponse { tag:old }); }
        let now=super::util::utc_now();
        tx.execute("UPDATE productivity_tag SET inactive=?1,revision=revision+1,updated_at_utc=?2 WHERE id=?3",params![req.inactive,now,req.tag.id])?;
        Ok(TagResponse { tag:tag_snapshot(tx,&req.tag.id,true)? })
    })
}

pub fn get_tag(data_dir: &str, id: &str) -> DomainResult<TagResponse> {
    super::coordinator::with_read(data_dir, |conn| {
        let conn=conn.ok_or_else(|| DomainError::root_not_found("tag not found"))?;
        super::coordinator::in_transaction(conn, |tx| Ok(TagResponse { tag:tag_snapshot(tx,id,true)? }))
    })
}

pub fn list_tags(data_dir: &str) -> DomainResult<TagsListResponse> {
    super::coordinator::with_read(data_dir, |conn| {
        let Some(conn)=conn else { return Ok(TagsListResponse { tags:vec![] }); };
        super::coordinator::in_transaction(conn, |tx| {
            let mut stmt=tx.prepare("SELECT id FROM productivity_tag WHERE deleted_at_utc IS NULL ORDER BY name_key,id")?;
            let ids=stmt.query_map([],|r|r.get::<_,String>(0))?.collect::<Result<Vec<_>,_>>()?;
            let tags=ids.iter().map(|id|tag_snapshot(tx,id,true)).collect::<DomainResult<Vec<_>>>()?;
            Ok(TagsListResponse { tags })
        })
    })
}

pub fn delete_tag_and_detach_items(data_dir: &str, req: DeleteTagAndDetachItemsRequest) -> DomainResult<DeleteTagAndDetachItemsResponse> {
    with_catalog_write(data_dir, |tx| {
        tag_ref(tx,&req.tag)?; let extra:String=tx.query_row("SELECT extra_json FROM productivity_tag WHERE id=?1",[&req.tag.id],|r|r.get(0))?; guard_unknown(&extra)?;
        let mut stmt=tx.prepare("SELECT i.id,i.revision,i.list_id,i.extra_json FROM productivity_item_tag x JOIN productivity_item i ON i.id=x.item_id WHERE x.tag_id=?1 ORDER BY i.id")?;
        let actual=stmt.query_map([&req.tag.id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,String>(3)?)))?.collect::<Result<Vec<_>,_>>()?;
        let mut expected=req.expected_members.clone(); expected.sort_by(|a,b|a.id.cmp(&b.id));
        if expected.len()!=actual.len() || expected.iter().zip(&actual).any(|(a,b)|a.id!=b.0 || a.expected_revision!=b.1) {
            return Err(DomainError::revision_conflict("tag member set differs"));
        }
        for (_,_,list_id,extra) in &actual {
            guard_unknown(extra)?;
            if let Some(lid)=list_id {
                let status:Option<String>=tx.query_row("SELECT status FROM productivity_list WHERE id=?1",[lid],|r|r.get(0)).optional()?;
                if status.as_deref()==Some("已归档") { return Err(DomainError::archived_list_readonly()); }
            }
        }
        let now=super::util::utc_now();
        let mut items=Vec::new();
        for (id,_,_,_) in &actual {
            tx.execute("DELETE FROM productivity_item_tag WHERE item_id=?1 AND tag_id=?2",params![id,req.tag.id])?;
            tx.execute("UPDATE productivity_item SET revision=revision+1,updated_at_utc=?1 WHERE id=?2",params![now,id])?;
            items.push(item_snapshot(tx,id,false)?);
        }
        tx.execute("UPDATE productivity_tag SET deleted_at_utc=?1,updated_at_utc=?1,revision=revision+1 WHERE id=?2",params![now,req.tag.id])?;
        Ok(DeleteTagAndDetachItemsResponse { tag:tag_snapshot(tx,&req.tag.id,false)?,items })
    })
}
