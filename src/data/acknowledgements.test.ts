import { describe, it, expect } from "vitest";
import data from "./acknowledgements.json";

/**
 * Characterization tests for the committed acknowledgements.json.
 *
 * These invariants were previously guarded by scripts/generate-acknowledgements.test.py,
 * which was never wired into any test runner. Moving them here ensures `bun run test`
 * enforces them.
 *
 * The "no bare shorthand" and "repository starts with http" checks would have failed
 * before the generate-acknowledgements.sh fix that replaced npm-style `owner/repo`
 * shorthands with full URLs and used `removesuffix` instead of `rstrip` to strip `.git`.
 */

describe("acknowledgements.json", () => {
  describe("arrays are non-empty", () => {
    it("has rust entries", () => {
      expect(data.rust.length).toBeGreaterThan(0);
    });

    it("has js entries", () => {
      expect(data.js.length).toBeGreaterThan(0);
    });

    it("has font entries", () => {
      expect(data.fonts.length).toBeGreaterThan(0);
    });
  });

  describe("every entry has required fields", () => {
    it("rust entries have name, version, license, and valid repository", () => {
      for (const entry of data.rust) {
        expect(entry.name).toBeTruthy();
        expect(typeof entry.version).toBe("string");
        expect(entry.version.length).toBeGreaterThan(0);
        expect(typeof entry.license).toBe("string");
        expect(entry.license.length).toBeGreaterThan(0);
        expect(typeof entry.repository).toBe("string");
        if (entry.repository !== "") {
          expect(
            entry.repository,
            `rust/${entry.name}: repository should start with 'http', got '${entry.repository}'`,
          ).toMatch(/^https?:\/\//);
        }
      }
    });

    it("js entries have name, version, license, and valid repository", () => {
      for (const entry of data.js) {
        expect(entry.name).toBeTruthy();
        expect(typeof entry.version).toBe("string");
        expect(entry.version.length).toBeGreaterThan(0);
        expect(typeof entry.license).toBe("string");
        expect(entry.license.length).toBeGreaterThan(0);
        expect(typeof entry.repository).toBe("string");
        if (entry.repository !== "") {
          expect(
            entry.repository,
            `js/${entry.name}: repository should start with 'http', got '${entry.repository}'`,
          ).toMatch(/^https?:\/\//);
        }
      }
    });

    it("font entries have name, license, and url starting with http", () => {
      for (const entry of data.fonts) {
        expect(entry.name).toBeTruthy();
        expect(typeof entry.license).toBe("string");
        expect(entry.license.length).toBeGreaterThan(0);
        expect(entry.url).toMatch(/^https?:\/\//);
      }
    });
  });

  describe("no repository is a bare shorthand", () => {
    const bareShorthand = /^[\w.@-]+\/[\w.@-]+$/;

    it("rust repositories are not bare owner/repo shorthands", () => {
      for (const entry of data.rust) {
        expect(
          bareShorthand.test(entry.repository),
          `rust/${entry.name}: repository '${entry.repository}' looks like a bare shorthand`,
        ).toBe(false);
      }
    });

    it("js repositories are not bare owner/repo shorthands", () => {
      for (const entry of data.js) {
        expect(
          bareShorthand.test(entry.repository),
          `js/${entry.name}: repository '${entry.repository}' looks like a bare shorthand`,
        ).toBe(false);
      }
    });
  });

  describe("list is narrowed to shipped dependencies", () => {
    // Dev-only tooling must not appear: the generator follows the runtime
    // `dependencies` closure, not the whole node_modules tree.
    const devOnly = ["eslint", "typescript", "vite", "vitest", "@types/react"];

    it("excludes dev-only tooling from the js list", () => {
      const names = new Set(data.js.map((e) => e.name));
      for (const dev of devOnly) {
        expect(names.has(dev), `js list should not include dev-only '${dev}'`).toBe(false);
      }
    });

    it("includes genuinely-shipped runtime deps", () => {
      const names = new Set(data.js.map((e) => e.name));
      for (const dep of ["react", "react-dom", "@tauri-apps/api"]) {
        expect(names.has(dep), `js list should include runtime '${dep}'`).toBe(true);
      }
    });
  });

  describe("known-good entries are present and correctly normalized", () => {
    it("serde has the correct full repository URL", () => {
      const serde = data.rust.find((e) => e.name === "serde");
      expect(serde).toBeDefined();
      expect(serde!.repository).toBe("https://github.com/serde-rs/serde");
    });

    it("tokio has the correct full repository URL", () => {
      const tokio = data.rust.find((e) => e.name === "tokio");
      expect(tokio).toBeDefined();
      expect(tokio!.repository).toBe("https://github.com/tokio-rs/tokio");
    });

    it("react has the correct full repository URL", () => {
      const react = data.js.find((e) => e.name === "react");
      expect(react).toBeDefined();
      expect(react!.repository).toBe("https://github.com/facebook/react");
    });

    it("zustand has the correct full repository URL", () => {
      const zustand = data.js.find((e) => e.name === "zustand");
      expect(zustand).toBeDefined();
      expect(zustand!.repository).toBe("https://github.com/pmndrs/zustand");
    });
  });
});
