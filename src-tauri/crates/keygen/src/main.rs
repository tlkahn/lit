use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
    let raw_args: Vec<String> = std::env::args().skip(1).collect();
    if raw_args.first().map(String::as_str) == Some("verify") {
        run_verify(&raw_args[1..]);
        return;
    }
    let args = match keygen::parse_args(&raw_args) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("Error: {e}\n");
            print_usage();
            std::process::exit(1);
        }
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before epoch")
        .as_secs();
    match keygen::generate_key(&args, now) {
        Ok(pem) => println!("{pem}"),
        Err(e) => {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
    }
}

fn run_verify(args: &[String]) {
    let mut pem_path: Option<String> = None;
    let mut vk_path: Option<String> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--pem" => {
                i += 1;
                pem_path = Some(
                    args.get(i)
                        .cloned()
                        .unwrap_or_else(|| usage_error("--pem requires a value")),
                );
            }
            "--verify-key" => {
                i += 1;
                vk_path = Some(
                    args.get(i)
                        .cloned()
                        .unwrap_or_else(|| usage_error("--verify-key requires a value")),
                );
            }
            other => usage_error(&format!("unknown flag: {other}")),
        }
        i += 1;
    }
    let pem_path =
        pem_path.unwrap_or_else(|| usage_error("verify requires --pem <file>"));
    let vk_path =
        vk_path.unwrap_or_else(|| usage_error("verify requires --verify-key <file>"));

    match keygen::verify_pem_file(Path::new(&pem_path), Path::new(&vk_path)) {
        Ok(payload) => {
            println!("License OK:");
            println!("  id: {}", payload.license_id);
            println!("  name: {}", payload.name);
            println!("  type: {}", payload.license_type);
            println!("  issued_at: {}", payload.issued_at);
        }
        Err(e) => {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
    }
}

fn usage_error(message: &str) -> ! {
    eprintln!("Error: {message}\n");
    print_usage();
    std::process::exit(1);
}

fn print_usage() {
    eprintln!(
        "Usage: keygen [OPTIONS]\n\n\
         Options:\n  \
           --name <NAME>       Licensee name (default: \"Dev Tester\")\n  \
           --email <EMAIL>     Licensee email (default: \"dev@lit.solar\")\n  \
           --expires <SPEC>    Duration (1d, 7d, 24h) or epoch timestamp (default: perpetual)\n  \
           --type <TYPE>       License type (default: \"personal\")\n  \
           --id <ID>           License ID (default: \"dev-<issued_at>\")\n  \
           --key <PATH>        Path to 32-byte Ed25519 signing seed\n\n\
         Verify a license pem against a 32-byte verifying key file:\n  \
           keygen verify --pem <file> --verify-key <file>"
    );
}
