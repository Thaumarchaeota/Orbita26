use serde::Serialize;
use std::sync::Mutex;
use sysinfo::System;

#[derive(Serialize, Clone)]
pub struct SystemStats {
    pub cpu_usage: f32,
    pub mem_usage: f32,
}

static SYSTEM: Mutex<Option<System>> = Mutex::new(None);

pub fn init() {
    let mut guard = SYSTEM.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_some() {
        return;
    }
    let mut system = System::new();
    system.refresh_cpu_usage();
    system.refresh_memory();
    *guard = Some(system);
}

pub fn read_stats() -> SystemStats {
    let mut guard = SYSTEM.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        init();
        guard = SYSTEM.lock().unwrap_or_else(|e| e.into_inner());
    }
    let system = guard.as_mut().unwrap();
    system.refresh_cpu_usage();
    system.refresh_memory();

    let total = system.total_memory();
    let used = system.used_memory();
    let mem_usage = if total > 0 {
        (used as f64 / total as f64 * 100.0) as f32
    } else {
        0.0
    };

    SystemStats {
        cpu_usage: system.global_cpu_usage(),
        mem_usage,
    }
}
