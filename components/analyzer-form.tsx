"use client";

import { useState } from "react";
import { GoogleReconnectLink } from "@/components/google-reconnect-link";
import { Button, Card } from "@/components/ui";
import { formatBytes } from "@/lib/format";
import { GOOGLE_REAUTH_REQUIRED } from "@/lib/google/auth-errors";
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
  code?: string;
}

interface ApiErrorPayload {
  error?: string;
  code?: string;
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
  const [error, setError] = useState<string | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pickingDestination, setPickingDestination] = useState(false);

  function updateSourceUrl(nextUrl: string) {
    setUrl(nextUrl);
    setError(null);
    setReauthRequired(false);
    if (analysis) setAnalysis(null);
  }

  async function analyze() {
    setLoading(true);
    setError(null);
    setReauthRequired(false);
    setAnalysis(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderUrl: url.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Unable to analyze folder");
        return;
      }
      setAnalysis(payload);
    } catch {
      setError("Unable to reach GDM. Check your connection and try again.");
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
    setReauthRequired(false);

    try {
      const [picker, response] = await Promise.all([
        loadGooglePickerApi(),
        fetch("/api/google/picker", { cache: "no-store" }),
      ]);
      const bootstrap = await response.json() as PickerBootstrap;

      if (!response.ok) {
        setError(bootstrap.error ?? "Unable to open Google Picker");
        setReauthRequired(bootstrap.code === GOOGLE_REAUTH_REQUIRED);
        return;
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

  async function startMigration() {
    if (!analysis) return;
    if (destinationMode === "folder" && !destinationFolderRef) {
      setError("Choose a destination folder from Google Drive before starting the migration.");
      return;
    }

    setCreating(true);
    setError(null);
    setReauthRequired(false);

    try {
      const response = await fetch("/api/migrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceFolderId: analysis.folderId,
          sourceFolderUrl: url.trim(),
          sourceFolderName: analysis.folderName,
          analysisToken: analysis.analysisToken,
          destinationFolderRef: destinationMode === "root" ? "root" : destinationFolderRef,
        }),
      });
      const payload = await response.json() as ApiErrorPayload & { migrationId?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to start migration");
        setReauthRequired(payload.code === GOOGLE_REAUTH_REQUIRED);
        return;
      }

      if (!payload.migrationId) {
        setError("Migration started without a migration ID. Try again.");
        return;
      }
      window.location.href = `/migrations/${payload.migrationId}`;
    } catch {
      setError("Unable to start the migration. Check your connection and try again.");
    } finally {
      setCreating(false);
    }
  }

  const destinationReady = destinationMode === "root" || Boolean(destinationFolderRef);
  const destinationName = destinationMode === "root" ? "My Drive" : pickedDestinationName;

  return (
    <Card className="space-y-5">
      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="folderUrl">Public Drive folder URL</label>
        <input
          id="folderUrl"
          value={url}
          onChange={(event) => updateSourceUrl(event.target.value)}
          placeholder="https://drive.google.com/drive/folders/xxxxxxxx"
          aria-describedby="folder-url-help"
          className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none ring-blue-500 focus:ring-2"
        />
        <p id="folder-url-help" className="mt-2 text-xs leading-5 text-slate-500">
          The source folder must be publicly accessible. GDM never modifies the source.
        </p>
      </div>

      <Button onClick={analyze} disabled={loading || !url.trim()}>{loading ? "Analyzing..." : "Analyze Folder"}</Button>

      {error ? <p role="alert" aria-live="polite" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {reauthRequired ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="mb-3 text-sm text-amber-900">Your GDM session is still open, but Google Drive permission needs a fresh connection.</p>
          <GoogleReconnectLink redirectTo="/" />
        </div>
      ) : null}

      {analysis ? (
        <div className="space-y-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Ready to migrate</p>
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
                onChange={() => {
                  setDestinationMode("root");
                  setError(null);
                  setReauthRequired(false);
                }}
              />
              My Drive
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={destinationMode === "folder"}
                onChange={() => {
                  setDestinationMode("folder");
                  setError(null);
                  setReauthRequired(false);
                }}
              />
              Choose an existing folder
            </label>

            {destinationMode === "folder" ? (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                <Button type="button" onClick={chooseDestinationFolder} disabled={pickingDestination || !isAuthenticated}>
                  {pickingDestination ? "Opening Drive..." : pickedDestinationName ? "Change destination" : "Choose from Google Drive"}
                </Button>
                {pickedDestinationName ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    Selected: {pickedDestinationName}
                  </div>
                ) : (
                  <p className="text-xs leading-5 text-slate-500">
                    Google Picker grants GDM access only to the folder you explicitly choose.
                  </p>
                )}
                {!isAuthenticated ? <p className="text-xs text-slate-600">Sign in with Google to choose a destination folder.</p> : null}
              </div>
            ) : null}
          </fieldset>

          {destinationName ? (
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              GDM will create <strong>{analysis.folderName}</strong> inside <strong>{destinationName}</strong>.
            </div>
          ) : null}

          <Button
            onClick={startMigration}
            disabled={creating || !isAuthenticated || !destinationReady}
          >
            {creating ? "Starting..." : "Start Migration"}
          </Button>

          {!authConfigured ? <p className="text-sm text-red-700">Google sign-in is not configured for this deployment.</p> : null}
          {authConfigured && !isAuthenticated ? <p className="text-sm text-slate-600">Sign in with Google before starting a migration.</p> : null}
        </div>
      ) : null}
    </Card>
  );
}
