"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { formatBytes } from "@/lib/format";
import type { FolderAnalysis } from "@/types/migration";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const GOOGLE_API_SCRIPT = "https://apis.google.com/js/api.js";

interface AnalyzerFormProps {
  isAuthenticated: boolean;
  authConfigured: boolean;
}

interface PickerView {
  setIncludeFolders(enabled: boolean): PickerView;
  setSelectFolderEnabled(enabled: boolean): PickerView;
  setMimeTypes(mimeTypes: string): PickerView;
  setMode(mode: string): PickerView;
  setEnableDrives(enabled: boolean): PickerView;
  setParent(parentId: string): PickerView;
}

interface PickerInstance {
  setVisible(visible: boolean): void;
}

interface PickerBuilder {
  addView(view: PickerView): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder;
  setMaxItems(max: number): PickerBuilder;
  setCallback(callback: (data: Record<string, unknown>) => void): PickerBuilder;
  build(): PickerInstance;
}

interface PickerNamespace {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId?: string) => PickerView;
  ViewId: { DOCS: string };
  DocsViewMode: { LIST: string };
  Action: { PICKED: string; CANCEL: string };
  Response: { ACTION: string; DOCUMENTS: string };
  Document: { ID: string; NAME: string; MIME_TYPE: string };
}

interface GoogleApiWindow extends Window {
  gapi?: {
    load(
      apiName: string,
      options: { callback: () => void; onerror?: () => void; timeout?: number; ontimeout?: () => void },
    ): void;
  };
  google?: { picker?: PickerNamespace };
}

interface PickerBootstrap {
  accessToken: string;
  developerKey: string;
  appId: string;
  error?: string;
}

let pickerApiPromise: Promise<PickerNamespace> | null = null;

function loadGooglePickerApi() {
  if (typeof window === "undefined") return Promise.reject(new Error("Google Picker requires a browser"));

  const googleWindow = window as GoogleApiWindow;
  if (googleWindow.google?.picker) return Promise.resolve(googleWindow.google.picker);
  if (pickerApiPromise) return pickerApiPromise;

  pickerApiPromise = new Promise<PickerNamespace>((resolve, reject) => {
    const loadPicker = () => {
      if (!googleWindow.gapi) {
        reject(new Error("Google API loader did not initialize"));
        return;
      }

      googleWindow.gapi.load("picker", {
        callback: () => {
          const picker = googleWindow.google?.picker;
          if (picker) resolve(picker);
          else reject(new Error("Google Picker did not initialize"));
        },
        onerror: () => reject(new Error("Google Picker failed to load")),
        timeout: 10_000,
        ontimeout: () => reject(new Error("Google Picker took too long to load")),
      });
    };

    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_API_SCRIPT}"]`);
    if (existingScript) {
      if (googleWindow.gapi) loadPicker();
      else {
        existingScript.addEventListener("load", loadPicker, { once: true });
        existingScript.addEventListener("error", () => reject(new Error("Google API script failed to load")), { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.src = GOOGLE_API_SCRIPT;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", loadPicker, { once: true });
    script.addEventListener("error", () => reject(new Error("Google API script failed to load")), { once: true });
    document.head.appendChild(script);
  });

  void pickerApiPromise.catch(() => {
    pickerApiPromise = null;
  });

  return pickerApiPromise;
}

export function AnalyzerForm({ isAuthenticated, authConfigured }: AnalyzerFormProps) {
  const [url, setUrl] = useState("");
  const [analysis, setAnalysis] = useState<FolderAnalysis | null>(null);
  const [destinationMode, setDestinationMode] = useState<"root" | "folder">("root");
  const [destinationFolderRef, setDestinationFolderRef] = useState("");
  const [pickedDestinationName, setPickedDestinationName] = useState<string | null>(null);
  const [mergeIntoDestination, setMergeIntoDestination] = useState(false);
  const [existingDestinationItems, setExistingDestinationItems] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pickingDestination, setPickingDestination] = useState(false);
  const [pickingExisting, setPickingExisting] = useState(false);

  async function analyze() {
    setLoading(true);
    setError(null);
    setAnalysis(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderUrl: url }),
      });
      const payload = await response.json<FolderAnalysis & { error?: string }>();
      if (!response.ok) {
        setError(payload.error ?? "Unable to analyze folder");
        return;
      }
      setAnalysis(payload);
    } catch {
      setError("Unable to reach Drive Migrator. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function chooseDestinationFolder() {
    if (!isAuthenticated) {
      setError("Sign in with Google before choosing a Drive folder.");
      return;
    }

    setPickingDestination(true);
    setError(null);

    try {
      const [picker, response] = await Promise.all([
        loadGooglePickerApi(),
        fetch("/api/google/picker", { cache: "no-store" }),
      ]);
      const bootstrap = await response.json() as PickerBootstrap;

      if (!response.ok) {
        throw new Error(bootstrap.error ?? "Unable to open Google Picker");
      }

      const view = new picker.DocsView(picker.ViewId.DOCS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes(FOLDER_MIME_TYPE)
        .setMode(picker.DocsViewMode.LIST)
        .setEnableDrives(true);

      await new Promise<void>((resolve) => {
        const pickerInstance = new picker.PickerBuilder()
          .addView(view)
          .setOAuthToken(bootstrap.accessToken)
          .setDeveloperKey(bootstrap.developerKey)
          .setAppId(bootstrap.appId)
          .setOrigin(window.location.origin)
          .setMaxItems(1)
          .setCallback((data) => {
            const action = data[picker.Response.ACTION];
            if (action === picker.Action.PICKED) {
              const documents = data[picker.Response.DOCUMENTS] as Array<Record<string, string>> | undefined;
              const document = documents?.[0];
              const folderId = document?.[picker.Document.ID];
              const folderName = document?.[picker.Document.NAME];
              const mimeType = document?.[picker.Document.MIME_TYPE];

              if (!folderId || (mimeType && mimeType !== FOLDER_MIME_TYPE)) {
                setError("Choose a Google Drive folder, not a file.");
              } else {
                setDestinationFolderRef(folderId);
                setPickedDestinationName(folderName ?? "Selected Drive folder");
                setMergeIntoDestination(false);
                setExistingDestinationItems([]);
              }
              resolve();
            } else if (action === picker.Action.CANCEL) {
              resolve();
            }
          })
          .build();

        pickerInstance.setVisible(true);
      });
    } catch (pickerError) {
      setError(pickerError instanceof Error ? pickerError.message : "Unable to open Google Picker");
    } finally {
      setPickingDestination(false);
    }
  }

  async function chooseAlreadyCopiedItems() {
    if (!isAuthenticated) {
      setError("Sign in with Google before choosing already-copied items.");
      return;
    }
    if (destinationMode !== "folder" || !destinationFolderRef.trim()) {
      setError("Choose the partially filled destination folder first.");
      return;
    }

    setPickingExisting(true);
    setError(null);

    try {
      const [picker, response] = await Promise.all([
        loadGooglePickerApi(),
        fetch("/api/google/picker", { cache: "no-store" }),
      ]);
      const bootstrap = await response.json() as PickerBootstrap;
      if (!response.ok) throw new Error(bootstrap.error ?? "Unable to open Google Picker");

      const destinationId = destinationFolderRef.trim();
      const view = new picker.DocsView(picker.ViewId.DOCS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMode(picker.DocsViewMode.LIST)
        .setParent(destinationId);

      await new Promise<void>((resolve) => {
        const pickerInstance = new picker.PickerBuilder()
          .addView(view)
          .setOAuthToken(bootstrap.accessToken)
          .setDeveloperKey(bootstrap.developerKey)
          .setAppId(bootstrap.appId)
          .setOrigin(window.location.origin)
          .setMaxItems(25)
          .setCallback((data) => {
            const action = data[picker.Response.ACTION];
            if (action === picker.Action.PICKED) {
              const documents = data[picker.Response.DOCUMENTS] as Array<Record<string, string>> | undefined;
              const items = (documents ?? []).flatMap((document) => {
                const id = document[picker.Document.ID];
                const name = document[picker.Document.NAME];
                return id ? [{ id, name: name ?? "Existing Drive item" }] : [];
              });
              setExistingDestinationItems(items);
              resolve();
            } else if (action === picker.Action.CANCEL) {
              resolve();
            }
          })
          .build();
        pickerInstance.setVisible(true);
      });
    } catch (pickerError) {
      setError(pickerError instanceof Error ? pickerError.message : "Unable to open Google Picker");
    } finally {
      setPickingExisting(false);
    }
  }

  async function startMigration() {
    if (!analysis) return;

    setCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/migrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceFolderId: analysis.folderId,
          sourceFolderUrl: url,
          sourceFolderName: analysis.folderName,
          destinationFolderRef: destinationMode === "root" ? "root" : destinationFolderRef.trim(),
          mergeIntoDestination: destinationMode === "folder" && mergeIntoDestination,
          existingDestinationItemIds: existingDestinationItems.map((item) => item.id),
        }),
      });
      const payload = await response.json<{ migrationId: string; error?: string }>();

      if (!response.ok) {
        setError(payload.error ?? "Unable to start migration");
        return;
      }

      window.location.href = `/migrations/${payload.migrationId}`;
    } catch {
      setError("Unable to start the migration. Check your connection and try again.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card className="space-y-5">
      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="folderUrl">Public Drive folder URL</label>
        <input
          id="folderUrl"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://drive.google.com/drive/folders/xxxxxxxx"
          className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none ring-blue-500 focus:ring-2"
        />
      </div>

      <Button onClick={analyze} disabled={loading || !url.trim()}>{loading ? "Analyzing..." : "Analyze Folder"}</Button>

      {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {analysis ? (
        <div className="space-y-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
          <div>
            <h3 className="mb-3 text-lg font-semibold text-slate-950">{analysis.folderName}</h3>
            <dl className="grid grid-cols-3 gap-3">
              <div><dt>Files</dt><dd className="font-bold">{analysis.files}</dd></div>
              <div><dt>Folders</dt><dd className="font-bold">{analysis.folders}</dd></div>
              <div><dt>Size</dt><dd className="font-bold">{formatBytes(analysis.size)}</dd></div>
            </dl>
          </div>

          <fieldset className="space-y-3">
            <legend className="font-medium text-slate-950">Destination</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={destinationMode === "root"}
                onChange={() => setDestinationMode("root")}
              />
              My Drive root
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={destinationMode === "folder"}
                onChange={() => setDestinationMode("folder")}
              />
              Existing Drive folder
            </label>

            {destinationMode === "folder" ? (
              <div className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="button" onClick={chooseDestinationFolder} disabled={pickingDestination || !isAuthenticated}>
                    {pickingDestination ? "Opening Drive..." : "Choose from Google Drive"}
                  </Button>
                  {pickedDestinationName ? (
                    <div className="flex flex-1 items-center rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                      Selected: {pickedDestinationName}
                    </div>
                  ) : null}
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium text-slate-600" htmlFor="destinationFolderRef">
                    Or paste a folder URL or ID
                  </label>
                  <input
                    id="destinationFolderRef"
                    value={destinationFolderRef}
                    onChange={(event) => {
                      setDestinationFolderRef(event.target.value);
                      setPickedDestinationName(null);
                      setMergeIntoDestination(false);
                      setExistingDestinationItems([]);
                    }}
                    placeholder="https://drive.google.com/drive/folders/xxxxxxxx"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none ring-blue-500 focus:ring-2"
                  />
                </div>
                <p className="text-xs leading-5 text-slate-500">
                  Picker is recommended because it grants Drive Migrator access only to the folder you choose. Pasted folders must already be accessible to the app.
                </p>

                <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
                  <label className="flex items-start gap-2 text-sm text-slate-800">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={mergeIntoDestination}
                      onChange={(event) => {
                        setMergeIntoDestination(event.target.checked);
                        if (!event.target.checked) setExistingDestinationItems([]);
                      }}
                    />
                    <span>
                      This folder already contains part of the source. Merge the source directly into it instead of creating another wrapper folder.
                    </span>
                  </label>

                  {mergeIntoDestination ? (
                    <div className="space-y-2">
                      <Button type="button" onClick={chooseAlreadyCopiedItems} disabled={pickingExisting || !pickedDestinationName}>
                        {pickingExisting ? "Opening Drive..." : "Choose files/folders already copied"}
                      </Button>
                      <p className="text-xs leading-5 text-slate-600">
                        Select up to 25 items already present in this folder. If a copied subfolder contains copied files, select the subfolder and those files too. GDM will reuse only Picker-authorized matches.
                      </p>
                      {existingDestinationItems.length ? (
                        <div className="rounded-lg bg-white px-3 py-2 text-xs text-emerald-700">
                          {existingDestinationItems.length} already-copied item{existingDestinationItems.length === 1 ? "" : "s"} selected.
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </fieldset>

          <Button
            onClick={startMigration}
            disabled={creating || !isAuthenticated || (destinationMode === "folder" && !destinationFolderRef.trim())}
          >
            {creating ? "Starting..." : "Start Migration"}
          </Button>

          {!authConfigured ? <p className="text-sm text-red-700">Set a real Google OAuth client ID and secret before starting a migration.</p> : null}
          {authConfigured && !isAuthenticated ? <p className="text-sm text-slate-600">Sign in with Google before starting a migration.</p> : null}
        </div>
      ) : null}
    </Card>
  );
}
