pub struct ConformanceRunner {
    scenarios: Vec<(&'static str, Box<dyn Fn() -> bool + Send>)>,
}

impl ConformanceRunner {
    pub fn new() -> Self {
        Self {
            scenarios: vec![],
        }
    }

    pub fn register(&mut self, name: &'static str, f: Box<dyn Fn() -> bool + Send>) {
        self.scenarios.push((name, f));
    }

    pub fn run_all(&self) -> Vec<(&'static str, bool)> {
        self.scenarios
            .iter()
            .map(|(name, f)| (*name, f()))
            .collect()
    }
}

impl Default for ConformanceRunner {
    fn default() -> Self {
        Self::new()
    }
}

#[test]
fn conformance_runner_skeleton() {
    let mut runner = ConformanceRunner::new();
    runner.register("noop", Box::new(|| true));
    let results = runner.run_all();
    assert_eq!(results.len(), 1);
    assert!(results[0].1);
}
