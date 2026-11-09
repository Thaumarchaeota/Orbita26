//! Negative interface fixture: disabling the SDK feature does not implement
//! a safe conversion from the desktop's existing rusqlite connection.
pub fn handoff_existing_connection(conn: rusqlite::Connection) {
    let _pool = powersync::ConnectionPool::single_connection(conn);
}
