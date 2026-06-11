import { useState, useEffect } from "react";
import { listBibFiles } from "../lib/ipc";

export interface UseBibFilePickerResult {
  bibFiles: string[];
  selectedBibFile: string;
  setSelectedBibFile: (v: string) => void;
  newBibPath: string;
  setNewBibPath: (v: string) => void;
  effectiveBibPath: string;
}

export function useBibFilePicker(
  workspacePath: string | null,
  open: boolean,
): UseBibFilePickerResult {
  const [bibFiles, setBibFiles] = useState<string[]>([]);
  const [selectedBibFile, setSelectedBibFile] = useState("");
  const [newBibPath, setNewBibPath] = useState("refs.bib");

  useEffect(() => {
    if (open) {
      setBibFiles([]);
      setSelectedBibFile("");
      setNewBibPath("refs.bib");

      if (workspacePath) {
        listBibFiles(workspacePath)
          .then((files) => {
            setBibFiles(files);
            if (files.length > 0) {
              setSelectedBibFile(files[0]!);
            } else {
              setSelectedBibFile("__new__");
            }
          })
          .catch(() => {
            setBibFiles([]);
            setSelectedBibFile("__new__");
          });
      }
    }
  }, [open, workspacePath]);

  const effectiveBibPath =
    selectedBibFile === "__new__"
      ? workspacePath && newBibPath
        ? `${workspacePath}/${newBibPath}`
        : ""
      : selectedBibFile;

  return {
    bibFiles,
    selectedBibFile,
    setSelectedBibFile,
    newBibPath,
    setNewBibPath,
    effectiveBibPath,
  };
}
