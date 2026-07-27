use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::{
    header::{ACCEPT, CONTENT_TYPE, REFERER},
    redirect::Policy,
    Client, Url,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex as StdMutex, OnceLock, Weak},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tokio::sync::{Mutex as AsyncMutex, Semaphore};

const ANCHOR_INFO_ENDPOINT: &str =
    "https://api.live.bilibili.com/live_user/v1/UserInfo/get_anchor_in_room";
const ROOM_INIT_ENDPOINT: &str = "https://api.live.bilibili.com/room/v1/Room/room_init";
const MASTER_INFO_ENDPOINT: &str = "https://api.live.bilibili.com/live_user/v1/Master/info";
const CACHE_SCHEMA_VERSION: u8 = 1;
const CACHE_TTL_SECS: u64 = 7 * 24 * 60 * 60;
const MAX_API_BYTES: u64 = 256 * 1024;
const MAX_IMAGE_BYTES: u64 = 1024 * 1024;
const MAX_CACHE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_CONCURRENT_FETCHES: usize = 4;
const MAX_ROOMS_PER_REQUEST: usize = 512;

type RoomLocks = HashMap<u64, Weak<AsyncMutex<()>>>;

static FETCH_LIMITER: OnceLock<Semaphore> = OnceLock::new();
static ROOM_LOCKS: OnceLock<StdMutex<RoomLocks>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RoomAvatarAsset {
    room_id: u64,
    uid: Option<u64>,
    data_url: Option<String>,
    stale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedAvatar {
    schema_version: u8,
    room_id: u64,
    uid: u64,
    name: String,
    source_url: String,
    content_type: String,
    data_base64: String,
    fetched_at: u64,
}

#[derive(Debug, Deserialize)]
struct BilibiliResponse<T> {
    code: i64,
    #[serde(default)]
    message: String,
    data: Option<T>,
}

#[derive(Debug, Deserialize)]
struct AnchorData {
    info: AnchorInfo,
}

#[derive(Debug, Deserialize)]
struct RoomInitData {
    uid: u64,
}

#[derive(Debug, Deserialize)]
struct AnchorInfo {
    uid: u64,
    #[serde(default)]
    uname: String,
    face: String,
}

fn fetch_limiter() -> &'static Semaphore {
    FETCH_LIMITER.get_or_init(|| Semaphore::new(MAX_CONCURRENT_FETCHES))
}

fn room_lock(room_id: u64) -> Arc<AsyncMutex<()>> {
    let locks = ROOM_LOCKS.get_or_init(|| StdMutex::new(HashMap::new()));
    let mut locks = locks
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(lock) = locks.get(&room_id).and_then(Weak::upgrade) {
        return lock;
    }
    if locks.len() >= MAX_ROOMS_PER_REQUEST * 2 {
        locks.retain(|_, lock| lock.strong_count() > 0);
    }

    let lock = Arc::new(AsyncMutex::new(()));
    locks.insert(room_id, Arc::downgrade(&lock));
    lock
}

impl CachedAvatar {
    fn is_fresh(&self, now: u64) -> bool {
        self.fetched_at <= now.saturating_add(5 * 60)
            && now.saturating_sub(self.fetched_at) <= CACHE_TTL_SECS
    }

    fn data_url(&self) -> Option<String> {
        if self.schema_version != CACHE_SCHEMA_VERSION
            || self.room_id == 0
            || self.uid == 0
            || self.data_base64.is_empty()
        {
            return None;
        }

        let bytes = BASE64.decode(&self.data_base64).ok()?;
        validate_image(&self.content_type, &bytes).ok()?;
        Some(format!(
            "data:{};base64,{}",
            self.content_type, self.data_base64
        ))
    }

    fn into_asset(self, stale: bool) -> RoomAvatarAsset {
        let data_url = self.data_url();
        RoomAvatarAsset {
            room_id: self.room_id,
            uid: Some(self.uid),
            data_url,
            stale,
        }
    }
}

fn unavailable_asset(room_id: u64, cached: Option<CachedAvatar>) -> RoomAvatarAsset {
    cached
        .map(|entry| entry.into_asset(true))
        .unwrap_or(RoomAvatarAsset {
            room_id,
            uid: None,
            data_url: None,
            stale: false,
        })
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn cache_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法定位头像缓存目录：{error}"))?
        .join("avatars")
        .join("v1");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建头像缓存目录：{error}"))?;
    Ok(directory)
}

fn cache_path(directory: &Path, room_id: u64) -> PathBuf {
    directory.join(format!("room-{room_id}.json"))
}

fn read_cache(directory: &Path, room_id: u64) -> Option<CachedAvatar> {
    let path = cache_path(directory, room_id);
    if fs::metadata(&path).ok()?.len() > MAX_CACHE_BYTES {
        return None;
    }

    let bytes = fs::read(path).ok()?;
    let cached: CachedAvatar = serde_json::from_slice(&bytes).ok()?;
    if cached.room_id != room_id || cached.data_url().is_none() {
        return None;
    }
    Some(cached)
}

fn write_cache(directory: &Path, cached: &CachedAvatar) -> Result<(), String> {
    let destination = cache_path(directory, cached.room_id);
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = directory.join(format!(
        ".room-{}-{}-{suffix}.tmp",
        cached.room_id,
        std::process::id()
    ));
    let contents =
        serde_json::to_vec(cached).map_err(|error| format!("序列化头像缓存失败：{error}"))?;

    fs::write(&temporary, contents).map_err(|error| format!("写入头像缓存失败：{error}"))?;
    if let Err(error) = fs::rename(&temporary, &destination) {
        if destination.exists() {
            fs::remove_file(&destination)
                .map_err(|remove_error| format!("替换头像缓存失败：{remove_error}"))?;
            fs::rename(&temporary, &destination)
                .map_err(|rename_error| format!("替换头像缓存失败：{rename_error}"))?;
        } else {
            let _ = fs::remove_file(&temporary);
            return Err(format!("保存头像缓存失败：{error}"));
        }
    }
    Ok(())
}

fn create_avatar_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(concat!("BiliRec-Control/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(12))
        .redirect(Policy::none())
        .build()
        .map_err(|error| format!("初始化头像网络客户端失败：{error}"))
}

fn normalized_content_type(value: &str) -> &str {
    value.split(';').next().unwrap_or_default().trim()
}

fn is_valid_webp(bytes: &[u8]) -> bool {
    if bytes.len() < 20 || !bytes.starts_with(b"RIFF") || &bytes[8..12] != b"WEBP" {
        return false;
    }
    let declared_size = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    if declared_size.checked_add(8) != Some(bytes.len()) {
        return false;
    }

    let mut cursor = 12usize;
    let mut has_image_data = false;
    while cursor < bytes.len() {
        let Some(header_end) = cursor.checked_add(8) else {
            return false;
        };
        if header_end > bytes.len() {
            return false;
        }

        let chunk_type = &bytes[cursor..cursor + 4];
        let chunk_size =
            u32::from_le_bytes(bytes[cursor + 4..header_end].try_into().unwrap()) as usize;
        let Some(chunk_end) = header_end.checked_add(chunk_size) else {
            return false;
        };
        if chunk_end > bytes.len() {
            return false;
        }
        if matches!(chunk_type, b"VP8 " | b"VP8L") && chunk_size > 0 {
            has_image_data = true;
        }

        let Some(next_cursor) = chunk_end.checked_add(chunk_size % 2) else {
            return false;
        };
        cursor = next_cursor;
    }

    cursor == bytes.len() && has_image_data
}

fn validate_image(content_type: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("头像内容为空".into());
    }
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("头像文件超过 1 MiB".into());
    }

    let valid = match normalized_content_type(content_type) {
        "image/jpeg" => {
            bytes.len() >= 4
                && bytes.starts_with(&[0xff, 0xd8, 0xff])
                && bytes.ends_with(&[0xff, 0xd9])
        }
        "image/png" => {
            bytes.len() >= 45
                && bytes.starts_with(b"\x89PNG\r\n\x1a\n")
                && &bytes[12..16] == b"IHDR"
                && &bytes[bytes.len() - 8..bytes.len() - 4] == b"IEND"
        }
        "image/webp" => is_valid_webp(bytes),
        "image/gif" => {
            bytes.len() >= 14
                && (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"))
                && bytes.last() == Some(&0x3b)
        }
        _ => false,
    };

    valid
        .then_some(())
        .ok_or_else(|| "头像响应不是受支持的图片格式".to_string())
}

async fn read_limited_body(
    mut response: reqwest::Response,
    limit: usize,
    label: &str,
) -> Result<Vec<u8>, String> {
    let mut body = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or_default()
            .min(limit as u64) as usize,
    );
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("读取{label}失败：{error}"))?
    {
        if chunk.len() > limit.saturating_sub(body.len()) {
            return Err(format!("{label}超过大小限制"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn normalize_avatar_url(value: &str) -> Result<Url, String> {
    let trimmed = value.trim();
    let normalized = if trimmed.starts_with("//") {
        format!("https:{trimmed}")
    } else {
        trimmed.to_string()
    };
    let mut url = Url::parse(&normalized).map_err(|_| "头像地址格式无效".to_string())?;

    if url.scheme() == "http" {
        url.set_scheme("https")
            .map_err(|_| "无法将头像地址升级为 HTTPS".to_string())?;
    }
    let host = url
        .host_str()
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "头像地址缺少主机名".to_string())?;
    if url.scheme() != "https"
        || !(host == "hdslb.com" || host.ends_with(".hdslb.com"))
        || !url.path().starts_with("/bfs/face/")
    {
        return Err("头像地址不属于受信任的哔哩哔哩图片域名".into());
    }

    let original_path = url.path().split('@').next().unwrap_or(url.path());
    url.set_path(&format!("{original_path}@128w_128h_1c.webp"));
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

async fn fetch_bilibili_data<T: DeserializeOwned>(
    client: &Client,
    url: Url,
    room_id: u64,
    label: &str,
) -> Result<T, String> {
    let response = client
        .get(url)
        .header(ACCEPT, "application/json")
        .header(REFERER, format!("https://live.bilibili.com/{room_id}"))
        .send()
        .await
        .map_err(|error| format!("{label}失败：{error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{label}失败（HTTP {}）", status.as_u16()));
    }
    if response.content_length().unwrap_or_default() > MAX_API_BYTES {
        return Err(format!("{label}响应过大"));
    }

    let body = read_limited_body(response, MAX_API_BYTES as usize, &format!("{label}响应")).await?;
    let payload: BilibiliResponse<T> =
        serde_json::from_slice(&body).map_err(|error| format!("解析{label}响应失败：{error}"))?;
    if payload.code != 0 {
        return Err(format!(
            "{label}接口返回错误 {}：{}",
            payload.code, payload.message
        ));
    }

    payload.data.ok_or_else(|| format!("{label}响应缺少 data"))
}

fn validate_anchor_info(info: AnchorInfo) -> Result<AnchorInfo, String> {
    if info.uid == 0 || info.face.trim().is_empty() {
        return Err("主播信息响应缺少头像".into());
    }
    Ok(info)
}

async fn fetch_anchor_info(client: &Client, room_id: u64) -> Result<AnchorInfo, String> {
    let mut direct_url =
        Url::parse(ANCHOR_INFO_ENDPOINT).map_err(|_| "主播信息接口地址无效".to_string())?;
    direct_url
        .query_pairs_mut()
        .append_pair("roomid", &room_id.to_string());
    let direct_error =
        match fetch_bilibili_data::<AnchorData>(client, direct_url, room_id, "获取主播信息")
            .await
            .and_then(|data| validate_anchor_info(data.info))
        {
            Ok(info) => return Ok(info),
            Err(error) => error,
        };

    let mut room_url =
        Url::parse(ROOM_INIT_ENDPOINT).map_err(|_| "房间解析接口地址无效".to_string())?;
    room_url
        .query_pairs_mut()
        .append_pair("id", &room_id.to_string());
    let room = fetch_bilibili_data::<RoomInitData>(client, room_url, room_id, "解析主播 UID")
        .await
        .map_err(|error| format!("{direct_error}；备用接口失败：{error}"))?;
    if room.uid == 0 {
        return Err(format!("{direct_error}；备用接口返回的主播 UID 无效"));
    }

    let mut master_url =
        Url::parse(MASTER_INFO_ENDPOINT).map_err(|_| "主播资料接口地址无效".to_string())?;
    master_url
        .query_pairs_mut()
        .append_pair("uid", &room.uid.to_string());
    fetch_bilibili_data::<AnchorData>(client, master_url, room_id, "获取主播资料")
        .await
        .and_then(|data| validate_anchor_info(data.info))
        .map_err(|error| format!("{direct_error}；备用接口失败：{error}"))
}

async fn download_avatar(
    client: &Client,
    room_id: u64,
    url: Url,
) -> Result<(String, String), String> {
    let response = client
        .get(url)
        .header(ACCEPT, "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
        .header(REFERER, format!("https://live.bilibili.com/{room_id}"))
        .send()
        .await
        .map_err(|error| format!("下载主播头像失败：{error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("下载主播头像失败（HTTP {}）", status.as_u16()));
    }
    if response.content_length().unwrap_or_default() > MAX_IMAGE_BYTES {
        return Err("头像文件超过 1 MiB".into());
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(normalized_content_type)
        .unwrap_or_default()
        .to_string();
    let bytes = read_limited_body(response, MAX_IMAGE_BYTES as usize, "主播头像").await?;
    validate_image(&content_type, &bytes)?;
    Ok((content_type, BASE64.encode(bytes)))
}

async fn load_room_avatar(
    client: &Client,
    directory: Option<&Path>,
    room_id: u64,
) -> RoomAvatarAsset {
    let room_lock = room_lock(room_id);
    let _room_guard = room_lock.lock().await;
    let now = unix_timestamp();
    let cached = directory.and_then(|path| read_cache(path, room_id));
    if cached.as_ref().is_some_and(|entry| entry.is_fresh(now)) {
        return cached.expect("fresh cache must exist").into_asset(false);
    }

    let _fetch_permit = fetch_limiter()
        .acquire()
        .await
        .expect("avatar fetch limiter must stay open");
    let refreshed = async {
        let anchor = fetch_anchor_info(client, room_id).await?;
        let source_url = normalize_avatar_url(&anchor.face)?;

        if let Some(mut cached) = cached
            .clone()
            .filter(|entry| entry.uid == anchor.uid && entry.source_url == source_url.as_str())
        {
            cached.name = anchor.uname;
            cached.fetched_at = now;
            if let Some(directory) = directory {
                if let Err(error) = write_cache(directory, &cached) {
                    log::warn!("无法更新房间 {room_id} 的头像缓存时间：{error}");
                }
            }
            return Ok::<CachedAvatar, String>(cached);
        }

        let (content_type, data_base64) =
            download_avatar(client, room_id, source_url.clone()).await?;
        let fresh = CachedAvatar {
            schema_version: CACHE_SCHEMA_VERSION,
            room_id,
            uid: anchor.uid,
            name: anchor.uname,
            source_url: source_url.to_string(),
            content_type,
            data_base64,
            fetched_at: now,
        };
        if let Some(directory) = directory {
            if let Err(error) = write_cache(directory, &fresh) {
                log::warn!("无法保存房间 {room_id} 的头像缓存：{error}");
            }
        }
        Ok(fresh)
    }
    .await;

    match refreshed {
        Ok(fresh) => fresh.into_asset(false),
        Err(error) => {
            log::warn!("无法刷新房间 {room_id} 的主播头像：{error}");
            unavailable_asset(room_id, cached)
        }
    }
}

pub(crate) async fn load_room_avatars(
    app: tauri::AppHandle,
    room_ids: Vec<u64>,
) -> Vec<RoomAvatarAsset> {
    let mut seen = HashSet::new();
    let room_ids = room_ids
        .into_iter()
        .filter(|room_id| *room_id > 0 && seen.insert(*room_id))
        .take(MAX_ROOMS_PER_REQUEST)
        .collect::<Vec<_>>();
    if room_ids.is_empty() {
        return Vec::new();
    }

    let directory = cache_directory(&app)
        .map_err(|error| log::warn!("{error}"))
        .ok();
    let client = match create_avatar_client() {
        Ok(client) => client,
        Err(error) => {
            log::warn!("{error}");
            let now = unix_timestamp();
            return room_ids
                .into_iter()
                .map(|room_id| {
                    if let Some(cached) = directory
                        .as_deref()
                        .and_then(|path| read_cache(path, room_id))
                    {
                        let stale = !cached.is_fresh(now);
                        return cached.into_asset(stale);
                    }
                    unavailable_asset(room_id, None)
                })
                .collect();
        }
    };

    let mut avatars = Vec::with_capacity(room_ids.len());
    for room_chunk in room_ids.chunks(MAX_CONCURRENT_FETCHES) {
        let mut tasks = Vec::with_capacity(room_chunk.len());
        for &room_id in room_chunk {
            let client = client.clone();
            let directory = directory.clone();
            tasks.push((
                room_id,
                tauri::async_runtime::spawn(async move {
                    load_room_avatar(&client, directory.as_deref(), room_id).await
                }),
            ));
        }

        for (room_id, task) in tasks {
            match task.await {
                Ok(avatar) => avatars.push(avatar),
                Err(error) => {
                    log::warn!("房间 {room_id} 的头像任务异常结束：{error}");
                    avatars.push(RoomAvatarAsset {
                        room_id,
                        uid: None,
                        data_url: None,
                        stale: false,
                    });
                }
            }
        }
    }
    avatars
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_webp() -> Vec<u8> {
        BASE64
            .decode(
                "UklGRkAAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAIAAAAAAFZQOCAYAAAAMAEAnQEqAQABAAFAJiWkAANwAP79NmgA",
            )
            .unwrap()
    }

    #[test]
    fn parses_anchor_response() {
        let payload: BilibiliResponse<AnchorData> = serde_json::from_str(
            r#"{
                "code": 0,
                "message": "success",
                "data": {
                    "info": {
                        "uid": 50329118,
                        "uname": "主播",
                        "face": "https://i2.hdslb.com/bfs/face/avatar.jpg"
                    }
                }
            }"#,
        )
        .unwrap();

        let info = payload.data.unwrap().info;
        assert_eq!(payload.code, 0);
        assert_eq!(info.uid, 50329118);
        assert_eq!(info.uname, "主播");
    }

    #[test]
    fn normalizes_trusted_avatar_url_to_thumbnail() {
        let url = normalize_avatar_url(
            "http://i2.hdslb.com/bfs/face/avatar.jpg@64w_64h_1c.webp?token=ignored",
        )
        .unwrap();

        assert_eq!(url.scheme(), "https");
        assert_eq!(
            url.as_str(),
            "https://i2.hdslb.com/bfs/face/avatar.jpg@128w_128h_1c.webp"
        );
    }

    #[test]
    fn rejects_untrusted_or_non_face_urls() {
        assert!(normalize_avatar_url("https://example.com/bfs/face/avatar.jpg").is_err());
        assert!(normalize_avatar_url("https://i0.hdslb.com/bfs/archive/cover.jpg").is_err());
        assert!(normalize_avatar_url("file:///tmp/avatar.jpg").is_err());
    }

    #[test]
    fn validates_content_type_and_image_signature() {
        assert!(validate_image("image/webp", &valid_webp()).is_ok());
        assert!(validate_image("image/webp; charset=binary", &valid_webp()).is_ok());
        assert!(validate_image("text/html", b"<html></html>").is_err());
        assert!(validate_image("image/webp", b"<html></html>").is_err());
        assert!(validate_image("image/webp", &valid_webp()[..20]).is_err());
    }

    #[test]
    fn cache_entry_builds_data_url_and_expires() {
        let cached = CachedAvatar {
            schema_version: CACHE_SCHEMA_VERSION,
            room_id: 6,
            uid: 50329118,
            name: "主播".into(),
            source_url: "https://i2.hdslb.com/bfs/face/avatar.jpg@128w_128h_1c.webp".into(),
            content_type: "image/webp".into(),
            data_base64: BASE64.encode(valid_webp()),
            fetched_at: 10_000,
        };

        assert!(cached.is_fresh(10_000 + CACHE_TTL_SECS));
        assert!(!cached.is_fresh(10_001 + CACHE_TTL_SECS));
        assert!(cached
            .data_url()
            .unwrap()
            .starts_with("data:image/webp;base64,"));
    }

    #[test]
    fn refresh_failure_returns_stale_cache_or_empty_fallback() {
        let cached = CachedAvatar {
            schema_version: CACHE_SCHEMA_VERSION,
            room_id: 6,
            uid: 50329118,
            name: "主播".into(),
            source_url: "https://i2.hdslb.com/bfs/face/avatar.jpg@128w_128h_1c.webp".into(),
            content_type: "image/webp".into(),
            data_base64: BASE64.encode(valid_webp()),
            fetched_at: 1,
        };

        let stale = unavailable_asset(6, Some(cached));
        assert_eq!(stale.room_id, 6);
        assert_eq!(stale.uid, Some(50329118));
        assert!(stale.data_url.is_some());
        assert!(stale.stale);

        let empty = unavailable_asset(7, None);
        assert_eq!(empty.room_id, 7);
        assert!(empty.data_url.is_none());
        assert!(!empty.stale);
    }
}
