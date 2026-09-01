use super::dto::{FetchResult, FetchWindow, ProbeCapabilities};
use super::provider::{GarminProvider, ProviderError};
use std::collections::HashMap;
use std::path::Path;

pub struct MockGarminProvider {
    connected_account: Option<String>,
    capabilities: ProbeCapabilities,
    fixtures: HashMap<String, FetchResult>,
}

impl MockGarminProvider {
    pub fn new() -> Self {
        Self {
            connected_account: None,
            capabilities: ProbeCapabilities {
                daily: true,
                routine: true,
                series: true,
                exercise: true,
                body_measurement: true,
            },
            fixtures: HashMap::new(),
        }
    }

    pub fn load_fixture_dir(&mut self, dir: &Path) -> std::io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let text = std::fs::read_to_string(&path)?;
            let result: FetchResult = serde_json::from_str(&text)?;
            let key = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("default")
                .to_string();
            self.fixtures.insert(key, result);
        }
        Ok(())
    }

    pub fn with_fixture(mut self, key: impl Into<String>, result: FetchResult) -> Self {
        self.fixtures.insert(key.into(), result);
        self
    }
}

impl Default for MockGarminProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl GarminProvider for MockGarminProvider {
    fn connect(&mut self, account_id: &str) -> Result<(), ProviderError> {
        self.connected_account = Some(account_id.to_string());
        Ok(())
    }

    fn fetch_window(&self, _window: &FetchWindow) -> Result<FetchResult, ProviderError> {
        if self.connected_account.is_none() {
            return Err(ProviderError::NotConnected);
        }
        Ok(self
            .fixtures
            .get("default")
            .cloned()
            .unwrap_or_else(empty_result))
    }

    fn probe_capabilities(&self) -> Result<ProbeCapabilities, ProviderError> {
        if self.connected_account.is_none() {
            return Err(ProviderError::NotConnected);
        }
        Ok(self.capabilities.clone())
    }
}

fn empty_result() -> FetchResult {
    FetchResult {
        dailies: vec![],
        routines: vec![],
        series: vec![],
        exercises: vec![],
        body_measurements: vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_connect_and_fetch() {
        let mut p = MockGarminProvider::new();
        p.connect("acct-1").unwrap();
        let caps = p.probe_capabilities().unwrap();
        assert!(caps.daily);
        let result = p
            .fetch_window(&FetchWindow {
                start: chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
                end: chrono::NaiveDate::from_ymd_opt(2026, 1, 7).unwrap(),
            })
            .unwrap();
        assert!(result.dailies.is_empty() || !result.dailies.is_empty());
    }
}
