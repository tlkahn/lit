use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
    let raw_args: Vec<String> = std::env::args().skip(1).collect();
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
        Ok(pem) => print!("{pem}"),
        Err(e) => {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
    }
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
           --key <PATH>        Path to 32-byte Ed25519 signing seed"
    );
}
