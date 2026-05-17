import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ConflictResolutionDialog } from "./ConflictResolutionDialog";
import type { KeyBinding } from "../lib/ipc";

const defaultConflict: KeyBinding = {
  command: "editor.toggleBold",
  key: "Mod-b",
  when: "editorFocus",
  source: "default",
};

const menuConflict: KeyBinding = {
  command: "app.preferences",
  key: "Mod-,",
  source: "menu",
};

describe("ConflictResolutionDialog", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <ConflictResolutionDialog
        open={false}
        newKey="Mod-b"
        newCommandLabel="My Command"
        conflicts={[defaultConflict]}
        platform="mac"
        onRebind={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-testid='conflict-dialog-backdrop']")).toBeNull();
  });

  it("shows backdrop and dialog when open=true", () => {
    const { container } = render(
      <ConflictResolutionDialog
        open={true}
        newKey="Mod-b"
        newCommandLabel="My Command"
        conflicts={[defaultConflict]}
        platform="mac"
        onRebind={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-testid='conflict-dialog-backdrop']")).not.toBeNull();
    expect(container.querySelector("[data-testid='conflict-dialog']")).not.toBeNull();
  });

  it("displays new key using KeyChord", () => {
    const { container } = render(
      <ConflictResolutionDialog
        open={true}
        newKey="Mod-b"
        newCommandLabel="My Command"
        conflicts={[defaultConflict]}
        platform="mac"
        onRebind={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-testid='key-chord']")).not.toBeNull();
  });

  it("displays conflicting command label", () => {
    const { getByText } = render(
      <ConflictResolutionDialog
        open={true}
        newKey="Mod-b"
        newCommandLabel="My Command"
        conflicts={[defaultConflict]}
        platform="mac"
        onRebind={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(getByText("editor.toggleBold")).toBeTruthy();
  });

  it("shows Rebind and Cancel buttons for default/user conflicts", () => {
    const { container } = render(
      <ConflictResolutionDialog
        open={true}
        newKey="Mod-b"
        newCommandLabel="My Command"
        conflicts={[defaultConflict]}
        platform="mac"
        onRebind={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-testid='conflict-rebind-btn']")).not.toBeNull();
    expect(container.querySelector("[data-testid='conflict-cancel-btn']")).not.toBeNull();
  });

  it("Escape key calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <ConflictResolutionDialog
        open={true}
        newKey="Mod-b"
        newCommandLabel="My Command"
        conflicts={[defaultConflict]}
        platform="mac"
        onRebind={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Rebind button calls onRebind", () => {
    const onRebind = vi.fn();
    const { container } = render(
      <ConflictResolutionDialog
        open={true}
        newKey="Mod-b"
        newCommandLabel="My Command"
        conflicts={[defaultConflict]}
        platform="mac"
        onRebind={onRebind}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector("[data-testid='conflict-rebind-btn']")!);
    expect(onRebind).toHaveBeenCalledTimes(1);
  });

  it("Cancel button calls onCancel", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConflictResolutionDialog
        open={true}
        newKey="Mod-b"
        newCommandLabel="My Command"
        conflicts={[defaultConflict]}
        platform="mac"
        onRebind={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(container.querySelector("[data-testid='conflict-cancel-btn']")!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  describe("menu conflict", () => {
    it("hides Rebind button when conflict has source=menu", () => {
      const { container } = render(
        <ConflictResolutionDialog
          open={true}
          newKey="Mod-,"
          newCommandLabel="My Command"
          conflicts={[menuConflict]}
          platform="mac"
          onRebind={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(container.querySelector("[data-testid='conflict-rebind-btn']")).toBeNull();
    });

    it("shows explanatory text for menu conflicts", () => {
      const { getByText } = render(
        <ConflictResolutionDialog
          open={true}
          newKey="Mod-,"
          newCommandLabel="My Command"
          conflicts={[menuConflict]}
          platform="mac"
          onRebind={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(getByText("Menu shortcuts cannot be rebound")).toBeTruthy();
    });

    it("Cancel button still works for menu conflicts", () => {
      const onCancel = vi.fn();
      const { container } = render(
        <ConflictResolutionDialog
          open={true}
          newKey="Mod-,"
          newCommandLabel="My Command"
          conflicts={[menuConflict]}
          platform="mac"
          onRebind={vi.fn()}
          onCancel={onCancel}
        />,
      );
      fireEvent.click(container.querySelector("[data-testid='conflict-cancel-btn']")!);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });
});
