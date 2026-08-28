"use client";

import { useState } from "react";
import {
  ArrowRight,
  Check,
  FileStack,
  Folder,
  FolderOpen,
  FolderTree,
  HardDrive,
  Link2,
  LoaderCircle,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { GoogleReconnectLink } from "@/components/google-reconnect-link";
import { Button, Card, cn } from "@/components/ui";
import { formatBytes } from "@/lib/format";
import { GOOGLE_REAUTH_REQUIRED } from "@/lib/google/auth-errors";
import type { SignedFolderAnalysis } from "@/types/migration";

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
  const [analysis, setAnalysis] = useState<SignedFolderAnalysis | null>(null);
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
    <Card className="overflow-hidden border-white/80 bg-white/95 p-0 shadow-[0_30px_90px_-45px_rgba(37,99,235,0.55)]">
      <div className="relative overflow-hidden bg-slate-950 px-6 py-6 text-white sm:px-7">
        <div className="absolute -right-14 -top-20 h-48 w-48 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute -bottom-24 left-14 h-44 w-44 rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="relative">
          <div className="mb-3 flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100">
              <Sparkles className="h-3 w-3" />
              New migration
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              Source untouched
            </span>
          </div>
          <h2 className="text-2xl font-black tracking-tight">Move your folder</h2>
          <p className="mt-1.5 max-w-md text-sm leading-6 text-slate-300">
            Give GDM a public Drive folder. We’ll inspect it first, then you choose exactly where the copy should land.
          </p>
        </div>
      </div>

      <div className="space-y-6 p-5 sm:p-7">
        <section>
          <div className="mb-3 flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-blue-600 text-xs font-black text-white">1</span>
            <div>
              <h3 className="text-sm font-bold text-slate-950">Source folder</h3>
              <p className="text-xs text-slate-500">Paste a publicly accessible Google Drive folder URL.</p>
            </div>
          </div>

          <div className="relative">
            <Link2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="folderUrl"
              value={url}
              onChange={(event) => updateSourceUrl(event.target.value)}
              placeholder="https://drive.google.com/drive/folders/..."
              aria-describedby="folder-url-help"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 py-3.5 pl-11 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
          </div>
          <p id="folder-url-help" className="mt-2 text-xs leading-5 text-slate-500">
            Anyone with the link must be able to view the source folder.
          </p>

          <Button className="mt-4 w-full" size="lg" onClick={analyze} disabled={loading || !url.trim()}>
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {loading ? "Analyzing folder..." : "Analyze folder"}
          </Button>
        </section>

        {error ? (
          <p role="alert" aria-live="polite" className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
            {error}
          </p>
        ) : null}

        {reauthRequired ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="mb-3 text-sm leading-6 text-amber-900">
              Your GDM session is still open, but Google Drive permission needs a fresh connection.
            </p>
            <GoogleReconnectLink redirectTo="/" />
          </div>
        ) : null}

        {analysis ? (
          <>
            <section className="border-t border-slate-100 pt-6">
              <div className="mb-4 flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-500 text-xs font-black text-white">2</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-950">Review the source</h3>
                  <p className="truncate text-xs text-slate-500">{analysis.folderName}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-cyan-50/60 p-4">
                <div className="mb-4 flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white text-emerald-600 shadow-sm">
                    <FolderTree className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="truncate font-bold text-slate-950">{analysis.folderName}</h4>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                        <Check className="h-3 w-3" /> Ready
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">GDM has mapped the folder before any transfer begins.</p>
                  </div>
                </div>

                <dl className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-white/80 p-3 shadow-sm">
                    <dt className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><FileStack className="h-3.5 w-3.5" /> Files</dt>
                    <dd className="mt-1 text-lg font-black text-slate-950">{analysis.files.toLocaleString()}</dd>
                  </div>
                  <div className="rounded-xl bg-white/80 p-3 shadow-sm">
                    <dt className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><Folder className="h-3.5 w-3.5" /> Folders</dt>
                    <dd className="mt-1 text-lg font-black text-slate-950">{analysis.folders.toLocaleString()}</dd>
                  </div>
                  <div className="rounded-xl bg-white/80 p-3 shadow-sm">
                    <dt className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><HardDrive className="h-3.5 w-3.5" /> Size</dt>
                    <dd className="mt-1 truncate text-lg font-black text-slate-950">{formatBytes(analysis.size)}</dd>
                  </div>
                </dl>
              </div>
            </section>

            <section className="border-t border-slate-100 pt-6">
              <div className="mb-4 flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-500 text-xs font-black text-white">3</span>
                <div>
                  <h3 className="text-sm font-bold text-slate-950">Choose destination</h3>
                  <p className="text-xs text-slate-500">GDM creates the migrated root folder inside your choice.</p>
                </div>
              </div>

              <fieldset>
                <legend className="sr-only">Destination</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={cn(
                    "cursor-pointer rounded-2xl border p-4 transition",
                    destinationMode === "root"
                      ? "border-blue-300 bg-blue-50 shadow-[0_10px_30px_-22px_rgba(37,99,235,0.8)]"
                      : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/40",
                  )}>
                    <input
                      className="sr-only"
                      type="radio"
                      name="destination"
                      checked={destinationMode === "root"}
                      onChange={() => {
                        setDestinationMode("root");
                        setError(null);
                        setReauthRequired(false);
                      }}
                    />
                    <div className="flex items-start gap-3">
                      <span className={cn(
                        "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                        destinationMode === "root" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500",
                      )}>
                        <HardDrive className="h-4 w-4" />
                      </span>
                      <span>
                        <strong className="block text-sm text-slate-950">My Drive</strong>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">Create it at the top level of your Drive.</span>
                      </span>
                    </div>
                  </label>

                  <label className={cn(
                    "cursor-pointer rounded-2xl border p-4 transition",
                    destinationMode === "folder"
                      ? "border-blue-300 bg-blue-50 shadow-[0_10px_30px_-22px_rgba(37,99,235,0.8)]"
                      : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/40",
                  )}>
                    <input
                      className="sr-only"
                      type="radio"
                      name="destination"
                      checked={destinationMode === "folder"}
                      onChange={() => {
                        setDestinationMode("folder");
                        setError(null);
                        setReauthRequired(false);
                      }}
                    />
                    <div className="flex items-start gap-3">
                      <span className={cn(
                        "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                        destinationMode === "folder" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500",
                      )}>
                        <FolderOpen className="h-4 w-4" />
                      </span>
                      <span>
                        <strong className="block text-sm text-slate-950">Existing folder</strong>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">Pick a destination with Google Picker.</span>
                      </span>
                    </div>
                  </label>
                </div>

                {destinationMode === "folder" ? (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={chooseDestinationFolder}
                      disabled={pickingDestination || !isAuthenticated}
                    >
                      {pickingDestination ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
                      {pickingDestination ? "Opening Google Drive..." : pickedDestinationName ? "Change destination" : "Choose from Google Drive"}
                    </Button>
                    {pickedDestinationName ? (
                      <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800">
                        <Check className="h-4 w-4" />
                        <span className="truncate">{pickedDestinationName}</span>
                      </div>
                    ) : (
                      <p className="mt-3 text-xs leading-5 text-slate-500">
                        Picker grants GDM access only to the folder you explicitly select.
                      </p>
                    )}
                  </div>
                ) : null}
              </fieldset>
            </section>

            <section className="border-t border-slate-100 pt-6">
              <div className="mb-4 flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-slate-950 text-xs font-black text-white">4</span>
                <div>
                  <h3 className="text-sm font-bold text-slate-950">Launch migration</h3>
                  <p className="text-xs text-slate-500">Your transfer runs through GDM’s worker queue.</p>
                </div>
              </div>

              {destinationName ? (
                <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm leading-6 text-blue-950">
                  <span className="text-blue-600">Destination:</span> GDM will create <strong>{analysis.folderName}</strong> inside <strong>{destinationName}</strong>.
                </div>
              ) : null}

              <Button
                className="w-full"
                size="lg"
                onClick={startMigration}
                disabled={creating || !isAuthenticated || !destinationReady}
              >
                {creating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {creating ? "Starting migration..." : "Start migration"}
              </Button>

              {!authConfigured ? (
                <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">Google sign-in is not configured for this deployment.</p>
              ) : null}
              {authConfigured && !isAuthenticated ? (
                <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  Sign in with Google from the top of the page before starting the transfer.
                </p>
              ) : null}
            </section>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">After analysis</p>
            <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
              <span className="rounded-xl bg-white px-3 py-2.5 shadow-sm">Review files + size</span>
              <span className="rounded-xl bg-white px-3 py-2.5 shadow-sm">Choose destination</span>
              <span className="rounded-xl bg-white px-3 py-2.5 shadow-sm">Launch + track</span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
