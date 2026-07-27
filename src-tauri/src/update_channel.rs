use serde::Serialize;
use serde_json::Value;
use std::time::Duration;
use tauri::{Manager, ResourceId, Runtime, Webview};
use tauri_plugin_updater::UpdaterExt;
use url::Url;

const PREVIEW_MANIFEST_URL: &str =
    "https://github.com/demogest/BiliRecControl/releases/download/ci-latest/latest.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEnvironment {
    target_triple: String,
    updater_target: String,
    bundle_type: String,
    platform_label: String,
    preview_supported: bool,
    preview_unsupported_reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: Value,
}

fn target_triple() -> &'static str {
    option_env!("TAURI_ENV_TARGET_TRIPLE").unwrap_or("unknown")
}

fn preview_supported(target: &str, bundle_type: Option<&str>) -> bool {
    match target {
        "x86_64-pc-windows-msvc" => matches!(bundle_type, None | Some("nsis")),
        "x86_64-unknown-linux-gnu" => {
            matches!(bundle_type, None | Some("appimage") | Some("deb"))
        }
        "x86_64-apple-darwin" | "aarch64-apple-darwin" => {
            matches!(bundle_type, None | Some("app") | Some("dmg"))
        }
        _ => false,
    }
}

fn platform_label(target: &str) -> String {
    match target {
        "x86_64-pc-windows-msvc" => "Windows x64".to_string(),
        "aarch64-pc-windows-msvc" => "Windows ARM64".to_string(),
        "x86_64-unknown-linux-gnu" => "Linux x64".to_string(),
        "aarch64-unknown-linux-gnu" => "Linux ARM64".to_string(),
        "x86_64-apple-darwin" => "macOS Intel".to_string(),
        "aarch64-apple-darwin" => "macOS Apple Silicon".to_string(),
        _ => target.to_string(),
    }
}

fn environment_for(
    target: &str,
    updater_target: Option<&str>,
    bundle_type: Option<&str>,
) -> UpdateEnvironment {
    let supported_architecture = matches!(
        target,
        "x86_64-pc-windows-msvc"
            | "x86_64-unknown-linux-gnu"
            | "x86_64-apple-darwin"
            | "aarch64-apple-darwin"
    );
    let is_supported = preview_supported(target, bundle_type);
    let bundle_type = bundle_type.unwrap_or("unknown");
    UpdateEnvironment {
        target_triple: target.to_string(),
        updater_target: updater_target.unwrap_or("unknown").to_string(),
        bundle_type: bundle_type.to_string(),
        platform_label: platform_label(target),
        preview_supported: is_supported,
        preview_unsupported_reason: (!is_supported).then(|| {
            if supported_architecture {
                format!(
                    "测试版不支持当前安装格式（{bundle_type}）；Windows 请使用 NSIS，Linux 请使用 AppImage 或 DEB。稳定版更新不受影响。"
                )
            } else {
                "测试版仅提供 Windows x64、Linux x64 和 macOS Universal 构建；当前平台仍可使用稳定版更新。"
                    .to_string()
            }
        }),
    }
}

#[tauri::command]
pub fn get_update_environment() -> UpdateEnvironment {
    let bundle_type = tauri::utils::platform::bundle_type().map(|value| value.to_string());
    environment_for(
        target_triple(),
        tauri_plugin_updater::target().as_deref(),
        bundle_type.as_deref(),
    )
}

#[tauri::command]
pub async fn check_preview_update<R: Runtime>(
    webview: Webview<R>,
    timeout: Option<u64>,
) -> Result<Option<UpdateMetadata>, String> {
    let environment = get_update_environment();
    if !environment.preview_supported {
        return Err(environment
            .preview_unsupported_reason
            .unwrap_or_else(|| "当前平台不支持测试版更新。".to_string()));
    }

    let endpoint =
        Url::parse(PREVIEW_MANIFEST_URL).map_err(|error| format!("测试版更新地址无效：{error}"))?;
    let mut builder = webview
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| format!("无法配置测试版更新源：{error}"))?;
    if let Some(timeout) = timeout {
        builder = builder.timeout(Duration::from_millis(timeout));
    }

    let updater = builder
        .build()
        .map_err(|error| format!("无法初始化测试版更新器：{error}"))?;
    let Some(update) = updater
        .check()
        .await
        .map_err(|error| format!("无法检查测试版更新：{error}"))?
    else {
        return Ok(None);
    };

    let metadata = UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: update
            .raw_json
            .get("pub_date")
            .and_then(Value::as_str)
            .map(str::to_string),
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    };

    Ok(Some(metadata))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_mainstream_preview_targets() {
        for target in [
            "x86_64-pc-windows-msvc",
            "x86_64-unknown-linux-gnu",
            "x86_64-apple-darwin",
            "aarch64-apple-darwin",
        ] {
            assert!(
                preview_supported(target, None),
                "{target} should be supported"
            );
        }

        for target in [
            "aarch64-pc-windows-msvc",
            "aarch64-unknown-linux-gnu",
            "x86_64-pc-windows-gnu",
            "x86_64-unknown-linux-musl",
            "i686-pc-windows-msvc",
            "armv7-unknown-linux-gnueabihf",
            "unknown",
        ] {
            assert!(
                !preview_supported(target, None),
                "{target} should be rejected"
            );
        }
    }

    #[test]
    fn unsupported_environment_explains_stable_fallback() {
        let environment = environment_for(
            "aarch64-pc-windows-msvc",
            Some("windows-aarch64"),
            Some("nsis"),
        );
        assert!(!environment.preview_supported);
        assert_eq!(environment.updater_target, "windows-aarch64");
        assert!(environment
            .preview_unsupported_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("稳定版")));
    }

    #[test]
    fn rejects_preview_bundle_formats_without_compatible_packages() {
        assert!(preview_supported("x86_64-pc-windows-msvc", Some("nsis")));
        assert!(!preview_supported("x86_64-pc-windows-msvc", Some("msi")));
        assert!(preview_supported(
            "x86_64-unknown-linux-gnu",
            Some("appimage")
        ));
        assert!(preview_supported("x86_64-unknown-linux-gnu", Some("deb")));
        assert!(!preview_supported("x86_64-unknown-linux-gnu", Some("rpm")));
    }

    #[test]
    fn reports_friendly_platform_names() {
        assert_eq!(platform_label("x86_64-pc-windows-msvc"), "Windows x64");
        assert_eq!(
            platform_label("aarch64-apple-darwin"),
            "macOS Apple Silicon"
        );
        assert_eq!(
            platform_label("riscv64gc-unknown-linux-gnu"),
            "riscv64gc-unknown-linux-gnu"
        );
    }
}
