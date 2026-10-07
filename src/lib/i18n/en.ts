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
  "app.root_missing": "Root element (#root) not found",

  // -----------------------------------------------------------------
  // Başlık çubuğu (TitleBar.tsx)
  // -----------------------------------------------------------------
  "title.brand_sub": "Advanced Download Manager",
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
  "menu.item.about": "About ADM",
  "menu.item.exit": "Exit",

  // -----------------------------------------------------------------
  // Araç çubuğu (Toolbar.tsx)
  // -----------------------------------------------------------------
  "tb.add": "Add URL",
  "tb.add_title": "Start a new download (Ctrl+N)",
  "tb.pause_all": "Pause",
  "tb.pause_all_title": "Pause all downloads",
  "tb.resume_all": "Resume",
  "tb.resume_all_title": "Resume all downloads",
  "tb.cancel_all": "Stop",
  "tb.cancel_all_title": "Stop all downloads",
  "tb.delete": "Delete",
  "tb.delete_title": "Delete the selected downloads",
  "tb.clear": "Clear List",
  "tb.clear_title": "Delete completed, failed and cancelled records",
  "tb.graph": "Graph",
  "tb.graph_title": "Toggle the speed graph",
  "tb.log": "Log",
  "tb.log_title": "Toggle the events log",
  "tb.selection": "selected",

  // -----------------------------------------------------------------
  // Kenar çubuğu (Sidebar.tsx)
  // -----------------------------------------------------------------
  "side.new": "New Download",
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
  "form.channels_hint": "{count} channels",
  "form.db_hint": "SQLite records enabled",
  "form.db_title": "Database: {path}",
  "form.err.default_dir": "Could not read the default folder: {error}",
  "form.err.start": "Could not start the download: {error}",
  "form.submit": "Add",
  "form.submitting": "Adding…",
  "form.url_placeholder": "https://server/file.bin",
  "form.warn.bad_scheme": "The URL must start with http:// or https://",
  "form.warn.no_url": "Enter a URL first",
  "add.url_title": "Address (paste it here)",
  "add.save_to": "Save to",
  "add.channels": "Connections",

  // -----------------------------------------------------------------
  // Tablo başlıkları (DownloadTable.tsx)
  // -----------------------------------------------------------------
  "col.idx": "#",
  "col.name": "File Name",
  "col.size": "Size",
  "col.progress": "Progress",
  "col.speed": "Speed",
  "col.eta": "Time Left",
  "col.channels": "Conn.",
  "col.status": "Status",
  "col.actions": "Actions",

  // -----------------------------------------------------------------
  // Tablo satırı (DownloadRow.tsx)
  // -----------------------------------------------------------------
  "row.aria": "Download list",
  "row.progress_aria": "Download progress",
  "row.size_unknown": "Size unknown",
  "row.selected": "{count} records selected",
  "row.hint": "Double-click: open the file · Right-click: actions · Shift/Ctrl: multi-select",

  // -----------------------------------------------------------------
  // Satır eylemleri (DownloadRow.tsx)
  // -----------------------------------------------------------------
  "act.pause": "Pause",
  "act.pause_title": "Pause the download",
  "act.resume": "Resume",
  "act.resume_title": "Resume where it left off",
  "act.cancel": "Stop",
  "act.cancel_title": "Stop the download",
  "act.delete": "Delete",
  "act.delete_title": "Delete the record and the file",
  "act.delete_record": "Delete from list",
  "act.delete_record_title": "Delete the record, keep the file",
  "act.open": "Open",
  "act.open_title": "Open the file",
  "act.folder": "Location",
  "act.folder_title": "Open the containing folder",
  "act.channels": "Channels",
  "act.channels_title": "Change the channel count",
  "act.busy_title": "The operation is running",
  "act.failed": "Could not {action}: {error}",
  "act.channels_apply": "Apply",
  "act.channels_cancel": "Cancel",
  "act.channels_label": "Channel count:",
  "act.channels_note":
    "Changing the channel count of a running download pauses it and resumes it with the new count.",

  // -----------------------------------------------------------------
  // Liste üstü ve boş durum (DownloadTable.tsx)
  // -----------------------------------------------------------------
  "list.clear": "Clear List",
  "list.clear_title": "Delete completed, failed and cancelled records",
  "list.empty_title": "No downloads in this view",
  "list.empty_hint": "Pick another task or category in the sidebar on the left.",
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
  "props.file": "File",
  "props.path": "Location",
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
  "graph.axis_speed": "MB/s",
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
  "spark.empty_title": "Building the speed history",

  // -----------------------------------------------------------------
  // Durum çubuğu (StatusBar.tsx)
  // -----------------------------------------------------------------
  "sb.disk_free": "Free space",
  "sb.speed": "Current speed",
  "sb.active": "Active",
  "sb.downloaded": "Downloaded",
  "sb.time": "Total time",
  "sb.ready": "Ready",

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
};