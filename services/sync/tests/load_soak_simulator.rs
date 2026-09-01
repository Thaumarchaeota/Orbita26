pub struct LoadSoakSimulator {
    pub virtual_clients: usize,
    pub ops_per_client: usize,
    pub duration_secs: u64,
}

impl LoadSoakSimulator {
    pub fn new(virtual_clients: usize, ops_per_client: usize, duration_secs: u64) -> Self {
        Self {
            virtual_clients,
            ops_per_client,
            duration_secs,
        }
    }

    pub fn estimated_ops(&self) -> usize {
        self.virtual_clients * self.ops_per_client
    }

    pub fn run_skeleton(&self) -> LoadReport {
        LoadReport {
            total_ops: self.estimated_ops(),
            completed: 0,
            errors: 0,
            p99_latency_ms: 0.0,
        }
    }
}

#[derive(Debug)]
pub struct LoadReport {
    pub total_ops: usize,
    pub completed: usize,
    pub errors: usize,
    pub p99_latency_ms: f64,
}

#[test]
fn soak_simulator_skeleton() {
    let sim = LoadSoakSimulator::new(10, 100, 60);
    assert_eq!(sim.estimated_ops(), 1000);
    let report = sim.run_skeleton();
    assert_eq!(report.total_ops, 1000);
}
