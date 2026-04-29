use std::io::{BufRead, Write};
use std::os::unix::net::UnixStream;
use std::process::Command;

use lit_lib::cli;

fn main() {
    let raw_arg = match std::env::args().nth(1) {
        Some(a) if !a.is_empty() => a,
        _ => {
            eprintln!("usage: lit <path>");
            std::process::exit(1);
        }
    };

    let cwd = std::env::current_dir()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let target = cli::resolve_arg(&raw_arg, &cwd);

    let request = match cli::cli_target_to_socket_request(&target) {
        Some(r) => r,
        None => {
            eprintln!("invalid path: {raw_arg}");
            std::process::exit(1);
        }
    };

    let socket_path = cli::socket_path();
    if let Ok(mut stream) = UnixStream::connect(&socket_path) {
        let json = serde_json::to_string(&request).unwrap();
        let _ = writeln!(stream, "{json}");
        let _ = stream.shutdown(std::net::Shutdown::Write);

        let mut reader = std::io::BufReader::new(&stream);
        let mut response = String::new();
        if reader.read_line(&mut response).is_ok() {
            if let Ok(resp) = serde_json::from_str::<cli::SocketResponse>(&response) {
                if !resp.ok {
                    if let Some(e) = resp.error {
                        eprintln!("error: {e}");
                    }
                    std::process::exit(1);
                }
            }
        }
    } else {
        let exe = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("Lit")))
            .unwrap_or_else(|| std::path::PathBuf::from("Lit"));

        let _ = Command::new(exe)
            .arg(&raw_arg)
            .spawn();
    }
}
