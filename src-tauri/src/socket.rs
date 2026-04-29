use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;

use crate::cli::{CliTarget, SocketRequest, SocketResponse};

pub async fn start_listener(
    socket_path: PathBuf,
    handler: impl Fn(CliTarget) -> Result<(), String> + Send + Sync + 'static,
) {
    cleanup_socket(&socket_path);

    if let Some(parent) = socket_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let listener = match UnixListener::bind(&socket_path) {
        Ok(l) => l,
        Err(e) => {
            tracing::error!(error = %e, "failed to bind socket");
            return;
        }
    };

    tracing::info!(path = %socket_path.display(), "socket listener started");

    loop {
        let (stream, _) = match listener.accept().await {
            Ok(conn) => conn,
            Err(e) => {
                tracing::warn!(error = %e, "socket accept failed");
                continue;
            }
        };

        let (reader, mut writer) = stream.into_split();
        let mut buf_reader = BufReader::new(reader);
        let mut line = String::new();

        let response = match buf_reader.read_line(&mut line).await {
            Ok(0) => continue,
            Ok(_) => match serde_json::from_str::<SocketRequest>(line.trim()) {
                Ok(req) => {
                    let path = PathBuf::from(&req.path);
                    if !path.exists() {
                        SocketResponse {
                            ok: false,
                            error: Some(format!("path does not exist: {}", req.path)),
                        }
                    } else {
                        let canonical = path.canonicalize().unwrap_or(path);
                        let target = if canonical.is_dir() {
                            CliTarget::Directory(canonical)
                        } else {
                            let workspace = canonical.parent().unwrap().to_path_buf();
                            let file = canonical
                                .file_name()
                                .unwrap()
                                .to_string_lossy()
                                .to_string();
                            CliTarget::File {
                                workspace,
                                file,
                                line: req.line,
                                col: req.col,
                            }
                        };
                        match handler(target) {
                            Ok(()) => SocketResponse {
                                ok: true,
                                error: None,
                            },
                            Err(e) => SocketResponse {
                                ok: false,
                                error: Some(e),
                            },
                        }
                    }
                }
                Err(e) => SocketResponse {
                    ok: false,
                    error: Some(format!("invalid JSON: {e}")),
                },
            },
            Err(e) => SocketResponse {
                ok: false,
                error: Some(format!("read error: {e}")),
            },
        };

        let json = serde_json::to_string(&response).unwrap_or_else(|_| {
            r#"{"ok":false,"error":"serialization failed"}"#.to_string()
        });
        let _ = writer.write_all(json.as_bytes()).await;
        let _ = writer.write_all(b"\n").await;
        let _ = writer.shutdown().await;
    }
}

pub fn cleanup_socket(path: &Path) {
    if path.exists() {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::UnixStream;

    async fn send_and_receive(socket_path: &Path, msg: &str) -> String {
        let stream = UnixStream::connect(socket_path).await.unwrap();
        let (reader, mut writer) = stream.into_split();
        writer.write_all(msg.as_bytes()).await.unwrap();
        writer.write_all(b"\n").await.unwrap();
        writer.shutdown().await.unwrap();

        let mut buf_reader = BufReader::new(reader);
        let mut response = String::new();
        buf_reader.read_line(&mut response).await.unwrap();
        response
    }

    #[tokio::test]
    async fn test_listener_accepts_and_responds_ok() {
        let dir = tempfile::tempdir().unwrap();
        let sock = dir.path().join("test.sock");

        let test_file = dir.path().join("note.md");
        fs::write(&test_file, "hello").unwrap();

        let sock_clone = sock.clone();
        tokio::spawn(async move {
            start_listener(sock_clone, |_target| Ok(())).await;
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let req = serde_json::json!({
            "action": "open",
            "path": test_file.to_str().unwrap()
        });
        let response = send_and_receive(&sock, &req.to_string()).await;
        let resp: SocketResponse = serde_json::from_str(response.trim()).unwrap();
        assert!(resp.ok);
        assert!(resp.error.is_none());
    }

    #[tokio::test]
    async fn test_listener_responds_error_on_bad_json() {
        let dir = tempfile::tempdir().unwrap();
        let sock = dir.path().join("test.sock");

        let sock_clone = sock.clone();
        tokio::spawn(async move {
            start_listener(sock_clone, |_target| Ok(())).await;
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let response = send_and_receive(&sock, "not json at all").await;
        let resp: SocketResponse = serde_json::from_str(response.trim()).unwrap();
        assert!(!resp.ok);
        assert!(resp.error.unwrap().contains("invalid JSON"));
    }

    #[tokio::test]
    async fn test_listener_responds_error_on_invalid_path() {
        let dir = tempfile::tempdir().unwrap();
        let sock = dir.path().join("test.sock");

        let sock_clone = sock.clone();
        tokio::spawn(async move {
            start_listener(sock_clone, |_target| Ok(())).await;
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let req = serde_json::json!({
            "action": "open",
            "path": "/nonexistent_path_99999/note.md"
        });
        let response = send_and_receive(&sock, &req.to_string()).await;
        let resp: SocketResponse = serde_json::from_str(response.trim()).unwrap();
        assert!(!resp.ok);
        assert!(resp.error.unwrap().contains("does not exist"));
    }

    #[tokio::test]
    async fn test_listener_removes_stale_socket() {
        let dir = tempfile::tempdir().unwrap();
        let sock = dir.path().join("test.sock");

        // Create a stale socket file
        fs::write(&sock, "stale").unwrap();
        assert!(sock.exists());

        let sock_clone = sock.clone();
        tokio::spawn(async move {
            start_listener(sock_clone, |_target| Ok(())).await;
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // Listener should have removed stale file and bound successfully
        let test_file = dir.path().join("note.md");
        fs::write(&test_file, "hello").unwrap();

        let req = serde_json::json!({
            "action": "open",
            "path": test_file.to_str().unwrap()
        });
        let response = send_and_receive(&sock, &req.to_string()).await;
        let resp: SocketResponse = serde_json::from_str(response.trim()).unwrap();
        assert!(resp.ok);
    }

    #[tokio::test]
    async fn test_cleanup_removes_socket_file() {
        let dir = tempfile::tempdir().unwrap();
        let sock = dir.path().join("test.sock");
        fs::write(&sock, "dummy").unwrap();
        assert!(sock.exists());

        cleanup_socket(&sock);
        assert!(!sock.exists());
    }

    #[tokio::test]
    async fn test_client_send_receive() {
        let dir = tempfile::tempdir().unwrap();
        let sock = dir.path().join("test.sock");

        let test_file = dir.path().join("test.md");
        fs::write(&test_file, "content").unwrap();

        let sock_clone = sock.clone();
        tokio::spawn(async move {
            start_listener(sock_clone, |_target| Ok(())).await;
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let req = SocketRequest {
            action: "open".to_string(),
            path: test_file.to_string_lossy().to_string(),
            line: Some(1),
            col: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        let response = send_and_receive(&sock, &json).await;
        let resp: SocketResponse = serde_json::from_str(response.trim()).unwrap();
        assert!(resp.ok);
    }
}
