//! Anki `.apkg` cardbox export (#1026).
//!
//! Thin wrapper over `genanki` (tlkahn/genanki-rs, tag v0.1.0): assemble the
//! package from frontend-rendered note HTML and write it to disk. No
//! zip/sqlite hand-rolling here.

use std::path::Path;
use serde::Deserialize;

/// Hardcoded lit-owned deck id (Anki convention: 1<<30 .. 1<<31). Do not change
/// casually - re-imports key off deck+model identity.
pub const LIT_CARDBOX_DECK_ID: i64 = 1_128_672_242;

/// Lit-owned Basic-shaped model id (Front/Back). Separate from genanki's
/// BASIC_MODEL id so custom CSS does not collide with upstream builtins.
pub const LIT_CARDBOX_MODEL_ID: i64 = 2_091_562_257;

/// Stable Anki deck id derived from the page key (`source_page_id` path).
///
/// A pure function of the key so re-exports of the same page update the same
/// deck in place, while different pages get distinct decks. Must not be
/// randomized per export - Anki merges by deck id. Mapped into the lit-owned
/// band `[1 << 30, 1 << 31)` (Anki convention for app-owned ids).
pub fn lit_cardbox_deck_id(page_key: &str) -> i64 {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(page_key.as_bytes());
    let n = u64::from_be_bytes(digest[0..8].try_into().expect("8 bytes"));
    const LO: i64 = 1 << 30;
    const SPAN: u64 = 1 << 30; // maps into [LO, LO+SPAN) = [1<<30, 1<<31)
    LO + (n % SPAN) as i64
}

/// Base card CSS: Basic-like typography safe for Anki fields. Rust owns this
/// so the common path never ships the large KaTeX CSS string.
const BASE_CARD_CSS: &str = r#".card {
 font-family: arial;
 font-size: 20px;
 text-align: left;
 color: black;
 background-color: white;
}
.card p { margin: 0 0 0.75em; }
.card pre { overflow-x: auto; background: #f8f8f8; padding: 0.75em; border-radius: 4px; }
.card blockquote { border-left: 3px solid #ddd; padding-left: 1em; color: #555; }
"#;

#[derive(Debug, Deserialize)]
pub struct CardboxAnkiNote {
    pub uuid: String,
    pub front_html: String,
    pub back_html: String,
}

/// Lit-owned Basic-shaped note type (Front/Back), matching genanki's
/// BASIC_MODEL template shape but with our own id/name/CSS.
pub(crate) fn lit_cardbox_model(extra_css: Option<&str>) -> genanki::Model {
    let mut css = BASE_CARD_CSS.to_string();
    if let Some(extra) = extra_css {
        css.push('\n');
        css.push_str(extra);
    }
    genanki::Model::new(LIT_CARDBOX_MODEL_ID, "Lit Cardbox")
        .field(genanki::Field::new("Front"))
        .field(genanki::Field::new("Back"))
        .template(genanki::Template::new(
            "Card 1",
            "{{Front}}",
            "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}",
        ))
        .css(css)
}

/// Assemble the package from frontend-rendered note HTML and write it to
/// `dest`. Returns the destination path string on success.
pub(crate) fn do_export_cardbox_anki(
    dest: &Path,
    deck_name: &str,
    notes: &[CardboxAnkiNote],
    model_css: Option<&str>,
) -> Result<String, String> {
    if notes.is_empty() {
        return Err("No cards to export".to_string());
    }

    let model = std::sync::Arc::new(lit_cardbox_model(model_css));
    let mut deck = genanki::Deck::new(LIT_CARDBOX_DECK_ID, deck_name);
    for note in notes {
        let anki_note = genanki::Note::new(
            std::sync::Arc::clone(&model),
            [note.front_html.clone(), note.back_html.clone()],
        )
        .map_err(|e| format!("Failed to build Anki note: {e}"))?
        .with_guid(genanki::guid_for(&[&note.uuid]));
        deck.add_note(anki_note);
    }

    genanki::Package::new(deck)
        .write_to_file(dest)
        .map_err(|e| format!("Failed to write Anki package: {e}"))?;
    Ok(dest.display().to_string())
}

#[tauri::command]
pub async fn export_cardbox_anki(
    destination: String,
    deck_name: String,
    notes: Vec<CardboxAnkiNote>,
    model_css: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        do_export_cardbox_anki(
            Path::new(&destination),
            &deck_name,
            &notes,
            model_css.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::collections::HashSet;
    use std::io::Read;
    use zip::ZipArchive;

    fn anki_note(uuid: &str, front: &str, back: &str) -> CardboxAnkiNote {
        CardboxAnkiNote {
            uuid: uuid.to_string(),
            front_html: front.to_string(),
            back_html: back.to_string(),
        }
    }

    /// Slice 0 compile gate: proves the pinned genanki dep resolves and the
    /// lit-owned deck id constant is wired through.
    #[test]
    fn lit_deck_id_and_name_construct() {
        let deck = genanki::Deck::new(LIT_CARDBOX_DECK_ID, "t");
        assert_eq!(deck.id(), LIT_CARDBOX_DECK_ID);
        assert_eq!(deck.name(), "t");
    }

    // Deck id is a stable pure function of the page key (#1026).
    #[test]
    fn deck_id_stable_for_same_key() {
        assert_eq!(
            lit_cardbox_deck_id("notes/a.md"),
            lit_cardbox_deck_id("notes/a.md")
        );
    }

    #[test]
    fn deck_id_differs_across_keys() {
        assert_ne!(
            lit_cardbox_deck_id("notes/a.md"),
            lit_cardbox_deck_id("notes/b.md")
        );
    }

    #[test]
    fn deck_id_in_anki_owned_band() {
        for key in ["notes/a.md", "notes/b.md", "deep/path/page.md"] {
            let id = lit_cardbox_deck_id(key);
            assert!(id >= 1 << 30, "{key}: {id} below band");
            assert!(id < 1 << 31, "{key}: {id} above band");
        }
    }

    /// Golden pin: algorithm drift (hash, byte order, band math) fails CI.
    #[test]
    fn deck_id_golden_notes_a_md() {
        assert_eq!(lit_cardbox_deck_id("notes/a.md"), 1_880_234_326);
    }

    fn open_zip(path: &std::path::Path) -> ZipArchive<std::fs::File> {
        ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap()
    }

    fn entry_names(z: &ZipArchive<std::fs::File>) -> HashSet<String> {
        (0..z.len())
            .map(|i| z.name_for_index(i).unwrap().to_string())
            .collect()
    }

    fn read_entry(z: &mut ZipArchive<std::fs::File>, name: &str) -> Vec<u8> {
        let mut f = z.by_name(name).unwrap();
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).unwrap();
        buf
    }

    /// Extract `collection.anki2` from the zip into a temp file and open it.
    fn open_collection(z: &mut ZipArchive<std::fs::File>) -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let bytes = read_entry(z, "collection.anki2");
        let db_path = dir.path().join("collection.anki2");
        std::fs::write(&db_path, bytes).unwrap();
        let conn = Connection::open(&db_path).unwrap();
        (dir, conn)
    }

    fn col_json(conn: &Connection, col: &str) -> serde_json::Value {
        let raw: String = conn
            .query_row(&format!("SELECT {col} FROM col"), [], |r| r.get(0))
            .unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    fn write_and_open(
        notes: &[CardboxAnkiNote],
        deck_name: &str,
        css: Option<&str>,
    ) -> (tempfile::TempDir, Connection, String) {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("out.apkg");
        let result = do_export_cardbox_anki(&dest, deck_name, notes, css);
        let dest_str = result.expect("export should succeed");
        assert_eq!(dest_str, dest.display().to_string());
        let mut z = open_zip(&dest);
        let (_dbdir, conn) = open_collection(&mut z);
        (dir, conn, dest_str)
    }

    // R1
    #[test]
    fn r1_happy_path_writes_nonempty_zip_with_collection_and_media() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("out.apkg");
        let notes = vec![anki_note("u1", "<p>front</p>", "<span>back</span>")];
        let result = do_export_cardbox_anki(&dest, "Deck", &notes, None);
        assert_eq!(result.unwrap(), dest.display().to_string());
        let bytes = std::fs::read(&dest).unwrap();
        assert!(!bytes.is_empty());
        let mut z = open_zip(&dest);
        let names = entry_names(&z);
        assert!(names.contains("collection.anki2"));
        assert!(names.contains("media"));
        assert_eq!(read_entry(&mut z, "media"), b"{}");
    }

    // R2
    #[test]
    fn r2_note_count_flds_and_deck_name_match() {
        let notes = vec![
            anki_note("u1", "<p>a</p>", "x"),
            anki_note("u2", "<p>b</p>", "y"),
        ];
        let (_dir, conn, _dest) = write_and_open(&notes, "My Deck", None);

        let count: i64 = conn
            .query_row("SELECT count(*) FROM notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);

        let flds: Vec<String> = conn
            .prepare("SELECT flds FROM notes ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(flds, vec!["<p>a</p>\x1fx", "<p>b</p>\x1fy"]);

        let decks = col_json(&conn, "decks");
        assert_eq!(decks[LIT_CARDBOX_DECK_ID.to_string()]["name"], "My Deck");
    }

    // R3
    #[test]
    fn r3_guid_column_equals_guid_for_uuid() {
        let notes = vec![
            anki_note("alpha-uuid", "<p>a</p>", "x"),
            anki_note("beta-uuid", "<p>b</p>", "y"),
        ];
        let (_dir, conn, _dest) = write_and_open(&notes, "D", None);

        let guids: Vec<String> = conn
            .prepare("SELECT guid FROM notes ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            guids,
            vec![
                genanki::guid_for(&["alpha-uuid"]),
                genanki::guid_for(&["beta-uuid"]),
            ]
        );
    }

    // R4
    #[test]
    fn r4_empty_back_field_round_trips_as_empty_second_field() {
        let notes = vec![anki_note("u1", "<p>f</p>", "")];
        let (_dir, conn, _dest) = write_and_open(&notes, "D", None);

        let flds: String = conn
            .query_row("SELECT flds FROM notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(flds, "<p>f</p>\x1f");
    }

    // R5
    #[test]
    fn r5_note_order_in_sqlite_matches_input_order() {
        let notes = vec![
            anki_note("first", "<p>1</p>", ""),
            anki_note("second", "<p>2</p>", ""),
            anki_note("third", "<p>3</p>", ""),
        ];
        let (_dir, conn, _dest) = write_and_open(&notes, "D", None);

        let uuids_by_guid: Vec<String> = conn
            .prepare("SELECT guid FROM notes ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let expected: Vec<String> = ["first", "second", "third"]
            .iter()
            .map(|u| genanki::guid_for(&[u]))
            .collect();
        assert_eq!(uuids_by_guid, expected);
    }

    // R6
    #[test]
    fn r6_same_uuid_yields_same_guid_across_two_writes() {
        let dir = tempfile::tempdir().unwrap();
        let notes = vec![anki_note("stable-uuid", "<p>a</p>", "b")];

        let dest1 = dir.path().join("one.apkg");
        do_export_cardbox_anki(&dest1, "D", &notes, None).unwrap();
        let dest2 = dir.path().join("two.apkg");
        do_export_cardbox_anki(&dest2, "D", &notes, None).unwrap();

        let guid_of = |dest: &std::path::Path| -> String {
            let mut z = open_zip(dest);
            let (_dbdir, conn) = open_collection(&mut z);
            conn.query_row("SELECT guid FROM notes", [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(guid_of(&dest1), guid_of(&dest2));
        assert_eq!(guid_of(&dest1), genanki::guid_for(&["stable-uuid"]));
    }

    // R7
    #[test]
    fn r7_missing_parent_dir_returns_err_with_no_partial_file() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("nonexistent").join("out.apkg");
        let notes = vec![anki_note("u1", "<p>f</p>", "b")];
        let result = do_export_cardbox_anki(&dest, "D", &notes, None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to write Anki package"));
        assert!(!dest.exists());
    }

    // R8
    #[test]
    fn r8_overwrite_existing_apkg_succeeds() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("out.apkg");
        std::fs::write(&dest, "old content").unwrap();
        let notes = vec![anki_note("u1", "<p>new</p>", "b")];
        do_export_cardbox_anki(&dest, "D", &notes, None).unwrap();

        let mut z = open_zip(&dest);
        let names = entry_names(&z);
        assert!(names.contains("collection.anki2"));
    }

    // R9
    #[test]
    fn r9_empty_notes_returns_err_and_writes_no_file() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("out.apkg");
        let result = do_export_cardbox_anki(&dest, "D", &[], None);
        assert!(result.is_err());
        assert!(!dest.exists());
    }

    // R10
    #[test]
    fn r10_model_is_basic_shaped_with_lit_model_id() {
        let notes = vec![anki_note("u1", "<p>f</p>", "b")];
        let (_dir, conn, _dest) = write_and_open(&notes, "D", None);

        let models = col_json(&conn, "models");
        let model = &models[LIT_CARDBOX_MODEL_ID.to_string()];
        assert_eq!(model["id"], LIT_CARDBOX_MODEL_ID.to_string());
        assert_eq!(model["flds"][0]["name"], "Front");
        assert_eq!(model["flds"][1]["name"], "Back");
        assert_eq!(model["tmpls"][0]["qfmt"], "{{Front}}");
        assert!(model["tmpls"][0]["afmt"].as_str().unwrap().contains("{{Back}}"));
    }

    // R11
    #[test]
    fn r11_deck_id_in_col_decks_json() {
        let notes = vec![anki_note("u1", "<p>f</p>", "b")];
        let (_dir, conn, _dest) = write_and_open(&notes, "D", None);

        let decks = col_json(&conn, "decks");
        assert_eq!(
            decks[LIT_CARDBOX_DECK_ID.to_string()]["id"],
            LIT_CARDBOX_DECK_ID
        );
    }

    // R12
    #[test]
    fn r12_optional_extra_css_appears_in_model_css() {
        let notes = vec![anki_note("u1", "<p>f</p>", "b")];
        let (_dir, conn, _dest) = write_and_open(&notes, "D", Some("KATEX-CSS-MARKER"));

        let models = col_json(&conn, "models");
        let css = models[LIT_CARDBOX_MODEL_ID.to_string()]["css"]
            .as_str()
            .unwrap();
        assert!(css.contains("KATEX-CSS-MARKER"));
        assert!(css.contains(".card"));
    }

    // R13
    #[test]
    fn r13_utf8_math_html_survives_flds_roundtrip() {
        let notes = vec![anki_note("u1", "<p>数学 𝔸</p>", "café $x^2$")];
        let (_dir, conn, _dest) = write_and_open(&notes, "D", None);

        let flds: String = conn
            .query_row("SELECT flds FROM notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(flds, "<p>数学 𝔸</p>\x1fcafé $x^2$");
    }
}
