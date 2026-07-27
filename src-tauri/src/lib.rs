mod avatar_cache;
mod update_channel;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::{Client, Method, Url};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiConnection {
    api_url: String,
    username: String,
    password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiResponse {
    ok: bool,
    status: u16,
    data: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileApiResult {
    exist: bool,
    path: Option<String>,
    files: Option<Vec<FileApiEntry>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileApiEntry {
    is_folder: bool,
    name: Option<String>,
    last_modified: String,
    size: Option<u64>,
    url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryFile {
    room_id: u64,
    room_name: String,
    folder_path: String,
    name: String,
    url: String,
    size: u64,
    last_modified: String,
    extension: String,
    is_video: bool,
    is_danmaku: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RoomHistory {
    room_id: u64,
    room_name: String,
    folder_path: String,
    video_count: usize,
    danmaku_count: usize,
    other_count: usize,
    total_video_bytes: u64,
    total_bytes: u64,
    first_recorded_at: Option<String>,
    last_recorded_at: Option<String>,
    last_activity_at: Option<String>,
    files: Vec<HistoryFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryOverview {
    room_count: usize,
    video_count: usize,
    danmaku_count: usize,
    total_video_bytes: u64,
    total_bytes: u64,
    latest_recorded_at: Option<String>,
    rooms: Vec<RoomHistory>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MpvStatus {
    installed: bool,
    path: Option<String>,
    version: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MpvPlayResult {
    pid: u32,
    player_path: String,
}

fn validate_connection(connection: &ApiConnection) -> Result<(), String> {
    if connection.username.trim().is_empty() || connection.password.is_empty() {
        return Err("请填写用户名和密码".into());
    }
    Ok(())
}

fn normalize_base_url(connection: &ApiConnection) -> Result<Url, String> {
    let mut base = Url::parse(connection.api_url.trim())
        .map_err(|_| "服务地址格式不正确，请填写完整的 http(s) 地址".to_string())?;

    if !matches!(base.scheme(), "http" | "https") {
        return Err("服务地址必须使用 http 或 https".into());
    }

    base.set_username("")
        .map_err(|_| "服务地址中的用户名无效".to_string())?;
    base.set_password(None)
        .map_err(|_| "服务地址中的密码无效".to_string())?;
    base.set_query(None);
    base.set_fragment(None);
    Ok(base)
}

fn build_api_url(connection: &ApiConnection, path: &str) -> Result<Url, String> {
    if !(path == "/api" || path.starts_with("/api/")) {
        return Err("仅允许访问录播姬 /api 接口".into());
    }

    let base = normalize_base_url(connection)?;
    let target = format!("{}{}", base.as_str().trim_end_matches('/'), path);
    Url::parse(&target).map_err(|_| "无法生成录播姬请求地址".to_string())
}

fn build_file_url(connection: &ApiConnection, file_url: &str) -> Result<Url, String> {
    if !file_url.starts_with("/file/") || file_url.contains("..") {
        return Err("只允许播放录播姬返回的 /file 文件地址".into());
    }

    let base = normalize_base_url(connection)?;
    base.join(file_url)
        .map_err(|_| "无法生成录制文件播放地址".to_string())
}

fn create_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("初始化网络客户端失败：{error}"))
}

async fn fetch_json<T: DeserializeOwned>(
    client: &Client,
    connection: &ApiConnection,
    url: Url,
) -> Result<T, String> {
    let response = client
        .get(url)
        .basic_auth(&connection.username, Some(&connection.password))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("无法连接录播姬：{error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取录播姬响应失败：{error}"))?;

    if !status.is_success() {
        return Err(format!("读取录制文件失败（HTTP {}）", status.as_u16()));
    }

    serde_json::from_str(&text).map_err(|error| format!("解析录播姬文件响应失败：{error}"))
}

async fn fetch_file_listing(
    client: &Client,
    connection: &ApiConnection,
    path: &str,
) -> Result<FileApiResult, String> {
    let mut url = build_api_url(connection, "/api/file")?;
    url.query_pairs_mut().append_pair("path", path);
    let result: FileApiResult = fetch_json(client, connection, url).await?;
    if !result.exist {
        return Err(format!(
            "录播目录不存在：{}",
            result.path.unwrap_or_default()
        ));
    }
    Ok(result)
}

fn join_virtual_path(parent: &str, child: &str) -> String {
    format!("{}/{}", parent.trim_end_matches('/'), child).replace("//", "/")
}

fn extension_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn is_video_extension(extension: &str) -> bool {
    matches!(
        extension,
        "flv" | "mp4" | "mkv" | "ts" | "m4v" | "webm" | "mov"
    )
}

async fn collect_room_files(
    client: &Client,
    connection: &ApiConnection,
    room_id: u64,
    room_name: &str,
    root_path: &str,
) -> Result<Vec<HistoryFile>, String> {
    let mut queue = vec![(root_path.to_string(), 0usize)];
    let mut output = Vec::new();

    while let Some((path, depth)) = queue.pop() {
        if output.len() >= 5_000 {
            break;
        }

        let listing = fetch_file_listing(client, connection, &path).await?;
        for entry in listing.files.unwrap_or_default() {
            let Some(name) = entry.name else {
                continue;
            };

            if entry.is_folder {
                if depth < 4 {
                    queue.push((join_virtual_path(&path, &name), depth + 1));
                }
                continue;
            }

            let Some(url) = entry.url else {
                continue;
            };
            let extension = extension_of(&name);
            output.push(HistoryFile {
                room_id,
                room_name: room_name.to_string(),
                folder_path: path.clone(),
                name,
                url,
                size: entry.size.unwrap_or_default(),
                last_modified: entry.last_modified,
                is_video: is_video_extension(&extension),
                is_danmaku: extension == "xml",
                extension,
            });
        }
    }

    output.sort_by(|left, right| right.last_modified.cmp(&left.last_modified));
    Ok(output)
}

fn parse_room_folder(name: &str) -> Option<(u64, String)> {
    let (room_id, room_name) = name.split_once('-')?;
    let room_id = room_id.parse::<u64>().ok()?;
    Some((room_id, room_name.to_string()))
}

fn existing_file(path: PathBuf) -> Option<PathBuf> {
    path.is_file().then_some(path)
}

fn find_mpv() -> Option<PathBuf> {
    if let Some(path) = env::var_os("MPV_PATH").map(PathBuf::from) {
        if let Some(path) = existing_file(path) {
            return Some(path);
        }
    }

    if let Some(paths) = env::var_os("PATH") {
        for directory in env::split_paths(&paths) {
            if let Some(path) = existing_file(directory.join("mpv.exe")) {
                return Some(path);
            }
        }
    }

    let mut candidates = Vec::new();
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        candidates.push(
            local_app_data
                .join("Microsoft")
                .join("WinGet")
                .join("Links")
                .join("mpv.exe"),
        );
        candidates.push(local_app_data.join("Programs").join("mpv").join("mpv.exe"));

        let packages = local_app_data
            .join("Microsoft")
            .join("WinGet")
            .join("Packages");
        if let Ok(entries) = fs::read_dir(packages) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("mpv-player.mpv-CI.MSVC_") || name.starts_with("shinchiro.mpv_")
                {
                    candidates.push(entry.path().join("mpv.exe"));
                }
            }
        }
    }

    if let Some(user_profile) = env::var_os("USERPROFILE").map(PathBuf::from) {
        candidates.push(
            user_profile
                .join("scoop")
                .join("apps")
                .join("mpv")
                .join("current")
                .join("mpv.exe"),
        );
    }
    candidates.push(PathBuf::from(r"C:\Program Files\mpv\mpv.exe"));

    candidates.into_iter().find_map(existing_file)
}

fn command_without_console(path: &Path) -> Command {
    let command = Command::new(path);
    #[cfg(target_os = "windows")]
    let command = {
        use std::os::windows::process::CommandExt;
        let mut command = command;
        command.creation_flags(0x0800_0000);
        command
    };
    command
}

#[tauri::command]
async fn bilirec_request(
    connection: ApiConnection,
    path: String,
    method: String,
    body: Option<Value>,
) -> Result<ApiResponse, String> {
    validate_connection(&connection)?;
    let target = build_api_url(&connection, &path)?;
    let method = match method.to_ascii_uppercase().as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        "DELETE" => Method::DELETE,
        _ => return Err("不支持的请求方法".into()),
    };

    let client = create_client()?;
    let mut request = client
        .request(method, target)
        .basic_auth(&connection.username, Some(&connection.password))
        .header(reqwest::header::ACCEPT, "application/json");

    if let Some(payload) = body {
        request = request.json(&payload);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("无法连接录播姬：{error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取录播姬响应失败：{error}"))?;

    let data = if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(Value::String(text))
    };

    Ok(ApiResponse {
        ok: status.is_success(),
        status: status.as_u16(),
        data,
    })
}

#[tauri::command]
async fn bilirec_history(connection: ApiConnection) -> Result<HistoryOverview, String> {
    validate_connection(&connection)?;
    let client = create_client()?;
    let root = fetch_file_listing(&client, &connection, "/").await?;
    let mut rooms = Vec::new();

    for entry in root.files.unwrap_or_default() {
        if !entry.is_folder {
            continue;
        }
        let Some(folder_name) = entry.name else {
            continue;
        };
        let Some((room_id, room_name)) = parse_room_folder(&folder_name) else {
            continue;
        };
        let folder_path = format!("/{folder_name}");
        let files =
            collect_room_files(&client, &connection, room_id, &room_name, &folder_path).await?;
        let video_files: Vec<&HistoryFile> = files.iter().filter(|file| file.is_video).collect();
        let danmaku_count = files.iter().filter(|file| file.is_danmaku).count();
        let other_count = files
            .len()
            .saturating_sub(video_files.len() + danmaku_count);
        let total_video_bytes = video_files.iter().map(|file| file.size).sum();
        let total_bytes = files.iter().map(|file| file.size).sum();
        let first_recorded_at = video_files
            .iter()
            .map(|file| file.last_modified.clone())
            .min();
        let last_recorded_at = video_files
            .iter()
            .map(|file| file.last_modified.clone())
            .max();
        let last_activity_at = files.iter().map(|file| file.last_modified.clone()).max();

        rooms.push(RoomHistory {
            room_id,
            room_name,
            folder_path,
            video_count: video_files.len(),
            danmaku_count,
            other_count,
            total_video_bytes,
            total_bytes,
            first_recorded_at,
            last_recorded_at,
            last_activity_at,
            files,
        });
    }

    rooms.sort_by(|left, right| right.last_recorded_at.cmp(&left.last_recorded_at));
    let latest_recorded_at = rooms
        .iter()
        .filter_map(|room| room.last_recorded_at.clone())
        .max();

    Ok(HistoryOverview {
        room_count: rooms.len(),
        video_count: rooms.iter().map(|room| room.video_count).sum(),
        danmaku_count: rooms.iter().map(|room| room.danmaku_count).sum(),
        total_video_bytes: rooms.iter().map(|room| room.total_video_bytes).sum(),
        total_bytes: rooms.iter().map(|room| room.total_bytes).sum(),
        latest_recorded_at,
        rooms,
    })
}

#[tauri::command]
async fn load_room_avatars(
    app: tauri::AppHandle,
    room_ids: Vec<u64>,
) -> Vec<avatar_cache::RoomAvatarAsset> {
    avatar_cache::load_room_avatars(app, room_ids).await
}

#[tauri::command]
fn mpv_status() -> MpvStatus {
    let Some(path) = find_mpv() else {
        return MpvStatus {
            installed: false,
            path: None,
            version: None,
        };
    };

    let version = command_without_console(&path)
        .arg("--version")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|output| {
            output
                .lines()
                .find(|line| line.trim_start().starts_with("mpv "))
                .or_else(|| output.lines().next())
                .map(str::to_string)
        });

    MpvStatus {
        installed: true,
        path: Some(path.to_string_lossy().to_string()),
        version,
    }
}

#[tauri::command]
fn open_live_room(app: tauri::AppHandle, room_id: u64) -> Result<(), String> {
    if room_id == 0 {
        return Err("直播间房间号无效".into());
    }

    let url = format!("https://live.bilibili.com/{room_id}");
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| format!("无法打开直播间：{error}"))
}

#[tauri::command]
fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = Url::parse(url.trim()).map_err(|_| "外部链接格式无效".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("仅允许打开 HTTP 或 HTTPS 外部链接".into());
    }

    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|error| format!("无法打开外部链接：{error}"))
}

#[tauri::command]
fn play_with_mpv(
    connection: ApiConnection,
    file_url: String,
    title: Option<String>,
) -> Result<MpvPlayResult, String> {
    validate_connection(&connection)?;
    let target = build_file_url(&connection, &file_url)?;
    let player = find_mpv().ok_or_else(|| "未找到 MPV，请先安装后重试。".to_string())?;
    let token = BASE64.encode(format!("{}:{}", connection.username, connection.password));
    let auth_header = format!("Authorization: Basic {token}");

    let mut command = command_without_console(&player);
    command
        .arg("--force-window=yes")
        .arg("--keep-open=yes")
        .arg("--no-terminal")
        .arg(format!("--http-header-fields={auth_header}"));
    if let Some(title) = title.filter(|value| !value.trim().is_empty()) {
        command.arg(format!("--title={title}"));
    }
    command
        .arg("--")
        .arg(target.as_str())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let child = command
        .spawn()
        .map_err(|error| format!("启动 MPV 失败：{error}"))?;
    Ok(MpvPlayResult {
        pid: child.id(),
        player_path: player.to_string_lossy().to_string(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bilirec_request,
            bilirec_history,
            update_channel::check_preview_update,
            update_channel::get_update_environment,
            load_room_avatars,
            mpv_status,
            open_live_room,
            open_external_url,
            play_with_mpv
        ])
        .run(tauri::generate_context!())
        .expect("启动录播姬控制中心失败");
}
