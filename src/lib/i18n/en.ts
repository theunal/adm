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
  "app.stat.speed": "current speed",
  "app.stat.total_downloaded": "total downloaded",
  "app.tab.active": "Active Downloads",
  "app.tab.history": "History",
  "app.log.hide": "Hide log",
  "app.log.show": "Show log",

  // -----------------------------------------------------------------
  // Başlık çubuğu (TitleBar.tsx)
  // -----------------------------------------------------------------
  "title.brand_sub": "Advanced Download Manager",
  "title.idle": "Idle",
  "title.lang.label": "Language",
  "title.summary.active": "active",
  "title.summary.downloaded": "downloaded",
  "title.summary.speed": "speed",
  "title.win.close": "Close",
  "title.win.maximize": "Maximize / Restore",
  "title.win.maximize_aria": "Maximize or restore",
  "title.win.minimize": "Minimize",
  "title.window": "ADM — Advanced Download Manager",

  // -----------------------------------------------------------------
  // Yeni indirme formu (NewDownloadForm.tsx)
  // -----------------------------------------------------------------
  "form.browse": "Browse",
  "form.channels_hint": "{count} channels",
  "form.channels_label": "Channel count",
  "form.db_hint": "SQLite records enabled",
  "form.db_title": "Database: {path}",
  "form.err.default_dir": "Could not read the default folder: {error}",
  "form.err.pick": "Could not choose a location: {error}",
  "form.err.start": "Could not start the download: {error}",
  "form.path_label": "Save location",
  "form.submit": "Add Download",
  "form.submitting": "Adding…",
  "form.title": "New Download",
  "form.url_label": "Address",
  "form.url_placeholder": "https://server/file.bin",
  "form.warn.bad_scheme": "The URL must start with http:// or https://",
  "form.warn.no_url": "Enter a URL first",

  // -----------------------------------------------------------------
  // Liste (DownloadList.tsx)
  // -----------------------------------------------------------------
  "list.clear": "Clear history",
  "list.clear_title": "Delete completed, failed and cancelled records",
  "list.empty.active_hint": "Fill in the form on the left to start a new download.",
  "list.empty.active_title": "No active downloads",
  "list.empty.history_hint": "Completed downloads are listed here.",
  "list.empty.history_title": "History is empty",
  "list.err.clear": "Could not clear the records: {error}",
  "list.failed_hint": "{count} failed • {bytes} incomplete",
  "list.failed_hint_title": "Amount downloaded by failed records",
  "list.title.active": "Active Downloads",
  "list.title.history": "History",

  // -----------------------------------------------------------------
  // Kart (DownloadCard.tsx)
  // -----------------------------------------------------------------
  "card.action.cancel": "Cancel",
  "card.action.channel_change": "Channel count change",
  "card.action.delete": "Delete",
  "card.action.delete_record": "Delete record",
  "card.action.failed": "{action} failed: {error}",
  "card.action.open_file": "Open file",
  "card.action.open_folder": "Open folder",
  "card.action.pause": "Pause",
  "card.action.resume": "Resume",
  "card.busy_title": "Operation in progress",
  "card.btn.cancel": "Cancel",
  "card.btn.cancel_title": "Cancel the download",
  "card.btn.channels": "Channels",
  "card.btn.channels_title": "Change the channel count",
  "card.btn.delete": "Delete",
  "card.btn.delete_title": "Delete the record and the file",
  "card.btn.del_record": "Delete record",
  "card.btn.del_record_title": "Delete the record, keep the file",
  "card.btn.folder": "Location",
  "card.btn.folder_title": "Open the folder",
  "card.btn.open": "Open",
  "card.btn.open_title": "Open the file",
  "card.btn.pause": "Pause",
  "card.btn.pause_title": "Pause the download",
  "card.btn.resume": "Resume",
  "card.btn.resume_title": "Resume from where it stopped",
  "card.channels.apply": "Apply",
  "card.channels.cancel": "Cancel",
  "card.channels.label": "Channel count:",
  "card.channels.note":
    "In a running download, changing the channel count pauses it and resumes it with the new count.",
  "card.channels_title": "Per-channel progress",
  "card.metric.added_at": "added",
  "card.metric.channels": "channels",
  "card.metric.downloaded": "downloaded",
  "card.metric.eta": "remaining",
  "card.metric.finished_at": "finished",
  "card.metric.in_status": "in state",
  "card.metric.speed": "speed",
  "card.progress_aria": "Download progress",
  "card.size_unknown": "Size unknown",

  // -----------------------------------------------------------------
  // Diyaloglar (DownloadCard.tsx -> api.ts)
  // -----------------------------------------------------------------
  "dialog.delete_file.body": "Delete the record \"{name}\" and the downloaded file?",
  "dialog.delete_file.title": "Delete download",
  "dialog.delete_record.body": "Delete the record \"{name}\"? The file is kept.",
  "dialog.delete_record.title": "Delete record",
  "dialog.save_title": "Choose the file to download",
  "dialog.confirm_title": "Confirm",

  // -----------------------------------------------------------------
  // Log paneli (LogPanel.tsx) ve grafik (Sparkline.tsx)
  // -----------------------------------------------------------------
  "log.aria": "Event log",
  "log.clear": "Clear",
  "log.empty": "No events yet.",
  "log.title": "Event Log",
  "log.to_bottom": "Scroll to bottom",
  "spark.empty_title": "Speed history is building up",

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