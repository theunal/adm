import type { Dict } from "./tr";

/**
 * İngilizce sözlük.
 *
 * `Dict = typeof tr` olduğu için burada **her anahtar** bulunmak zorundadır:
 * eksik bir anahtar ya da fazladan bir anahtar `tsc --noEmit` hatası verir
 * (`npm run build` bunu zorlar).
 */
export const en: Dict = {
  // -----------------------------------------------------------------
  // Uygulama kabuğu (App.tsx)
  // -----------------------------------------------------------------
  "app.init_failed": "Failed to start the app: {error}",
  "app.loading": "Loading records…",
  "app.root_missing": "The interface could not be started",

  // -----------------------------------------------------------------
  // Başlık çubuğu (TitleBar.tsx)
  // -----------------------------------------------------------------
  "title.lang.label": "Language",
  "title.win.close": "Close",
  "title.win.maximize": "Maximize / Restore",
  "title.win.maximize_aria": "Maximize or restore",
  "title.win.minimize": "Minimize",
  "title.window": "ADM — Advanced Download Manager",

  // -----------------------------------------------------------------
  // Menü çubuğu (MenuBar.tsx)
  // -----------------------------------------------------------------
  "menu.file": "File",
  "menu.downloads": "Downloads",
  "menu.tasks": "Tasks",
  "menu.options": "Options",
  "menu.help": "Help",
  "menu.item.add_url": "Add URL",
  "menu.item.open_file": "Open File",
  "menu.item.open_folder": "Open Containing Folder",
  "menu.item.copy_url": "Copy Address to Clipboard",
  "menu.item.pause_all": "Pause All",
  "menu.item.resume_all": "Resume All",
  "menu.item.cancel_all": "Stop All",
  "menu.item.select_all": "Select All",
  "menu.item.clear_history": "Clear List",
  "menu.item.delete_record": "Delete from List",
  "menu.item.delete_download": "Delete Download",
  "menu.item.properties": "Properties…",
  "menu.item.speed_graph": "Speed Graph",
  "menu.item.event_log": "Events Log",
  "menu.item.settings": "Settings…",
  "menu.item.browser_setup": "Browser Extension…",
  "menu.item.about": "About ADM",
  "menu.item.exit": "Exit",

  // -----------------------------------------------------------------
  // Araç çubuğu (Toolbar.tsx)
  // -----------------------------------------------------------------
  "tb.add": "Add download",
  "tb.add_title": "Start a new download (Ctrl+N)",
  "tb.search": "Search downloads...",
  "tb.graph": "Graph",
  "tb.graph_title": "Toggle the speed graph",
  "tb.log": "Log",
  "tb.log_title": "Toggle the events log",

  // -----------------------------------------------------------------
  // Kenar çubuğu (Sidebar.tsx)
  // -----------------------------------------------------------------
  "side.tasks": "Tasks",
  "side.categories": "Categories",
  "side.task.downloading": "Downloading",
  "side.task.queued": "Queued",
  "side.task.paused": "Paused",
  "side.task.completed": "Completed",
  "side.task.failed": "Failed",
  "side.task.cancelled": "Cancelled",
  "side.task.all": "All Downloads",
  "side.cat.video": "Video",
  "side.cat.audio": "Audio",
  "side.cat.program": "Programs",
  "side.cat.archive": "Compressed",
  "side.cat.document": "Documents",
  "side.cat.other": "Other Files",

  // -----------------------------------------------------------------
  // Yeni indirme formu (NewDownloadForm.tsx)
  // -----------------------------------------------------------------
  "form.browse": "Browse",
  "form.cancel": "Cancel",
  "form.channels_hint": "{count} channels",
  "form.db_hint": "Download history is recorded",
  "form.db_title": "Where records are stored: {path}",
  "form.err.start": "Could not start the download: {error}",
  "form.err_url.empty": "Enter an address first",
  "form.err_url.scheme": "Only http:// and https:// addresses are supported",
  "form.err_url.syntax": "Enter a valid address (e.g. https://server/file.bin)",
  "form.submit": "Add",
  "form.submitting": "Adding…",
  "form.title": "New Download",
  "form.url_label": "Address",
  "form.url_placeholder": "https://server/file.bin",
  "add.save_to": "Save to",
  "add.channels": "Connections",

  // -----------------------------------------------------------------
  // Tablo başlıkları (DownloadTable.tsx)
  // -----------------------------------------------------------------
  "col.idx": "#",
  "col.name": "File Name",
  "col.size": "Size",
  "col.speed": "Speed",
  "col.eta": "Time Left",
  "col.status": "Status",
  "col.date": "Added",

  // -----------------------------------------------------------------
  // Sort keys (Toolbar.tsx)
  // -----------------------------------------------------------------
  "sort.status": "By status",
  "sort.newest": "Newest",
  "sort.oldest": "Oldest",
  "sort.name": "By name",
  "sort.size": "By size",
  "sort.progress": "By progress",

  // -----------------------------------------------------------------
  // Tablo satırı (DownloadRow.tsx)
  // -----------------------------------------------------------------
  "row.aria": "Download list",
  "row.progress_aria": "Download progress",
  "row.size_unknown": "Size unknown",
  "row.select_aria": "Select {name}",
  "row.select_title": "Select the record (Shift/Ctrl for multiple)",
  "row.more_title": "Actions",
  "row.channels_title": "{count} channels",

  // -----------------------------------------------------------------
  // Satır eylemleri (DownloadRow.tsx)
  // -----------------------------------------------------------------
  "act.pause": "Pause",
  "act.resume": "Resume",
  "act.cancel": "Stop",
  "act.delete": "Delete",
  "act.delete_record": "Delete from list",
  "act.open": "Open",
  "act.folder": "Location",
  "act.channels": "Channels",
  "act.failed": "Could not {action}: {error}",
  "act.channels_label": "Channel count:",
  "act.channels_note":
    "Changing the channel count of a running download pauses it and resumes it with the new count.",

  // -----------------------------------------------------------------
  // Liste üstü ve boş durum (DownloadTable.tsx)
  // -----------------------------------------------------------------
  "list.clear": "Clear List",
  "list.clear_title": "Delete completed, failed and cancelled records",
  "list.drop_title": "Drop a URL here",
  "list.drop_hint": "Or use the Add download button in the toolbar",
  "list.err.clear": "Could not clear the records: {error}",
  "list.failed_hint": "{count} failed • {bytes} partial",
  "list.failed_hint_title": "How much the failed records downloaded",

  // -----------------------------------------------------------------
  // Diyaloglar
  // -----------------------------------------------------------------
  "dialog.confirm_title": "Confirmation",
  "dialog.save_title": "Choose the file to download",
  "dialog.delete_file.title": "Delete the download",
  "dialog.delete_file.body": "Delete the record \"{name}\" and the downloaded file?",
  "dialog.delete_record.title": "Delete from list",
  "dialog.delete_record.body": "Delete the record \"{name}\"? The file is kept.",
  "dialog.bulk_delete.title": "Delete multiple",
  "dialog.bulk_delete.body": "Delete {count} records?",
  "dialog.copied": "The address was copied to the clipboard",

  // Özellikler penceresi
  "props.title": "Download Properties",
  "props.url": "Address",
  "props.size": "Size",
  "props.status": "Status",
  "props.channels": "Channel count",
  "props.created": "Added",
  "props.finished": "Finished",
  "props.close": "Close",

  // Hakkında
  "about.title": "About ADM",
  "about.desc": "Multi-connection advanced download manager",
  "about.tech": "Rust + Tauri 2 + SolidJS",
  "about.ok": "OK",

  // -----------------------------------------------------------------
  // Hız grafiği (SpeedGraph.tsx)
  // -----------------------------------------------------------------
  "graph.title": "Speed Graph",
  "graph.empty": "No speed data yet.",
  "graph.axis_time": "Time",
  "graph.peak": "Peak speed",
  "graph.average": "Average speed",
  "graph.now": "Current",
  "graph.samples": "Samples",

  // -----------------------------------------------------------------
  // Log paneli (LogPanel.tsx) ve grafik (Sparkline.tsx)
  // -----------------------------------------------------------------
  "log.aria": "Events log",
  "log.title": "Events Log",
  "log.clear": "Clear",
  "log.empty": "No events yet.",
  "log.to_bottom": "Go to bottom",
  "log.channels_changed": "{name} channel count set to {count}",
  "spark.empty_title": "Building the speed history",

  // -----------------------------------------------------------------
  // Durum çubuğu (StatusBar.tsx)
  // -----------------------------------------------------------------
  "sb.disk_free": "Free space",
  "sb.speed": "Current speed",
  "sb.on": "ON",
  "sb.off": "OFF",
  "sb.master_title": "Pause / resume all downloads",
  "sb.free": "free",
  "sb.quality_title": "Quality tier derived from the measured speed",
  "sb.quality.ok": "HIGH",
  "sb.quality.warn": "MEDIUM",
  "sb.quality.idle": "LOW",
  "sb.selected_many": "{count} records selected",
  "sb.dock_show": "Open the speed graph",
  "sb.dock_hide": "Hide the bottom panel",

  // -----------------------------------------------------------------
  // Ayarlar (SettingsPanel.tsx)
  // -----------------------------------------------------------------
  "settings.channels_hint":
    "This count is used by default for new downloads. You can change the channel count of a running download with the “Channels” button in the table.",
  "settings.channels_label": "Default channel count",
  "settings.dir.audio": "Audio files",
  "settings.dir.audio_hint": "mp3, flac, wav, aac, m4a and other audio extensions",
  "settings.dir.default": "General location",
  "settings.dir.default_hint":
    "Files that match nothing and the categories left blank below go here. It cannot be emptied.",
  "settings.dir.inherit": "Fall back to the general location",
  "settings.dir.other": "Other files",
  "settings.dir.other_hint":
    "Archives, installers, documents and disk images (zip, exe, iso, pdf…)",
  "settings.dir.reset": "Reset this category",
  "settings.dir.video": "Video files",
  "settings.dir.video_hint": "mp4, mkv, avi, mov, webm and other video extensions",
  "settings.err.channels": "Could not save the channel count: {error}",
  "settings.err.lang": "Could not save the language: {error}",
  "settings.err.pick": "Could not pick the folder: {error}",
  "settings.err.save": "Could not save the setting: {error}",
  "settings.folders_intro":
    "The location is decided by the file extension. Categories left blank fall back to the general location.",
  "settings.lang_hint":
    "Your language choice is saved and stays in effect the next time you open the app.",
  "settings.pick_folder": "Pick a folder for {target}",
  "settings.section.channels": "Channels",
  "settings.section.folders": "Download locations",
  "settings.section.language": "Language",

  // -----------------------------------------------------------------
  // Depo (store.ts)
  // -----------------------------------------------------------------
  "error.unknown": "Unknown error",
  "log.list_refresh_failed": "Could not refresh the list: {error}",
  "log.records_load_failed": "Could not load the records: {error}",
  "log.records_loaded": {
    one: "{count} record loaded",
    other: "{count} records loaded",
  },
  "log.status_line": "{name}: {status}",
  "bulk.deleted": "{count} records deleted",

  // -----------------------------------------------------------------
  // Biçimlendirme (format.ts)
  // -----------------------------------------------------------------
  "dur.days_hours": "{days}d {hours}h",
  "dur.hours_minutes": "{hours}h {minutes}m",
  "dur.minutes_seconds": "{minutes}m {seconds}s",
  "dur.one_second": "1s",
  "dur.seconds_only": "{seconds}s",
  "status.Cancelled": "Cancelled",
  "status.Completed": "Completed",
  "status.Downloading": "Downloading",
  "status.Failed": "Failed",
  "status.Paused": "Paused",
  "status.Queued": "Queued",

  // -----------------------------------------------------------------
  // Browser extension setup wizard (BrowserSetupDialog.tsx)
  // -----------------------------------------------------------------
  "wizard.title": "Browser extension setup",
  "wizard.step.prepare": "Prepare files",
  "wizard.step.open": "Open extensions page",
  "wizard.step.load": "Load the extension",
  "wizard.step.connect": "Verify connection",
  "wizard.bridge_off":
    "The browser bridge is not running. Check the port under Settings ▸ Browsers; the extension cannot deliver downloads without it.",
  "wizard.bridge_on": "The bridge is listening on 127.0.0.1:{port}.",
  "wizard.hint.prepare":
    "The extension files for {browser} will be copied into the ADM folder. You will point the browser at this folder next.",
  "wizard.hint.open":
    "On the page that opens, turn on “Developer mode” in the top right, then click “Load unpacked”.",
  "wizard.hint.open_firefox":
    "On the page that opens, click “Load Temporary Add-on…”.",
  "wizard.hint.load":
    "In the file picker, choose the folder below and confirm the manifest.json inside it. You can open the folder first.",
  "wizard.hint.load_firefox":
    "Open the folder below and select the manifest.json inside it.",
  "wizard.hint.connect":
    "The extension is loaded. Start a download in the browser and ADM will report the connection here.",
  "wizard.action.prepare": "Prepare files",
  "wizard.action.open": "Open extensions page",
  "wizard.action.open_firefox": "Open about:debugging",
  "wizard.action.open_folder": "Open folder",
  "wizard.action.recheck": "Re-check connection",
  "wizard.working": "Preparing…",
  "wizard.prepared": "Extension files are ready",
  "wizard.connected": "{browser} connected",
  "wizard.close": "Close",
};
