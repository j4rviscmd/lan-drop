//! Persisted user settings (`config.json` in the app data dir).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct Settings {
    /// Upload destination as chosen (absolute, not canonicalized — the app
    /// canonicalizes on use so the file stays human-readable in a editor).
    pub upload_dir: PathBuf,
}

fn path(data_dir: &Path) -> PathBuf {
    data_dir.join("config.json")
}

/// Missing or corrupt file → defaults: the app must never fail to start
/// over its own settings.
pub fn load(data_dir: &Path, default_upload_dir: PathBuf) -> Settings {
    let parsed = std::fs::read_to_string(path(data_dir))
        .ok()
        .and_then(|text| match serde_json::from_str(&text) {
            Ok(s) => Some(s),
            Err(e) => {
                eprintln!("lan-drop: config.json unreadable ({e}), using defaults");
                None
            }
        });
    parsed.unwrap_or(Settings {
        upload_dir: default_upload_dir,
    })
}

pub fn save(data_dir: &Path, settings: &Settings) -> std::io::Result<()> {
    std::fs::write(
        path(data_dir),
        serde_json::to_string_pretty(settings).map_err(std::io::Error::other)?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_falls_back_on_missing_or_corrupt_file() {
        let dir = std::env::temp_dir().join(format!("lan-drop-settings-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let default = Settings {
            upload_dir: PathBuf::from("C:/default"),
        };

        // missing file
        assert_eq!(
            load(&dir, default.upload_dir.clone()).upload_dir,
            default.upload_dir
        );
        // corrupt file
        std::fs::write(dir.join("config.json"), "{not json").unwrap();
        assert_eq!(
            load(&dir, default.upload_dir.clone()).upload_dir,
            default.upload_dir
        );
        // saved choice wins over the default
        save(&dir, &default).unwrap();
        assert_eq!(
            load(&dir, PathBuf::from("C:/other")).upload_dir,
            default.upload_dir
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
