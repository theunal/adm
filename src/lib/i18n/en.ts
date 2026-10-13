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
  // Menu bar entries — also used by the row context menu (RowContextMenu.tsx)
  // -----------------------------------------------------------------
  "menu.item.paste_url": "Paste from Clipboard",
  "menu.item.open_file": "Open File",
  "menu.item.open_folder": "Open Containing Folder",
  "menu.item.copy_url": "Copy Address to Clipboard",
  "menu.item.cancel_all": "Stop All",
  "menu.item.select_all": "Select All",
  "menu.item.clear_history": "Clear List",
  "menu.item.delete_record": "Delete from List",
  "menu.item.delete_download": "Delete Download",
  "menu.item.properties": "Properties…",
  "menu.item.detail_window": "Open in Separate Window",
  "menu.item.settings": "Settings…",
  "menu.item.browser_setup": "Browser Extension…",
  "menu.item.about": "About ADM",

  // -----------------------------------------------------------------
  // Sidebar overlay menu (Sidebar.tsx) + title bar buttons (TitleBar.tsx)
  // -----------------------------------------------------------------
  "side.open": "Open the menu",
  "side.close": "Close the menu",
  "side.actions": "Actions",
  "side.tools": "Tools",
  "tb.add": "Add download",
  "tb.search": "Search downloads...",

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
  "side.task.unfinished": "Unfinished",
  "side.nav_aria": "Download categories",
  "side.all": "All Downloads",
  "side.state": "Status",
  "side.completed": "Completed",
  "side.unfinished": "Unfinished",
  "side.cat.video": "Video",
  "side.cat.audio": "Audio",
  "side.cat.program": "Programs",
  "side.cat.archive": "Compressed",
  "side.cat.document": "Documents",
  "side.cat.other": "Other Files",

  // -----------------------------------------------------------------
  // File categories (MC `categories::Category`)
  // -----------------------------------------------------------------
  "cat.image": "Images",
  "cat.music": "Music",
  "cat.video": "Video",
  "cat.apps": "Programs",
  "cat.document": "Documents",
  "cat.compressed": "Compressed",
  "cat.other": "Other",

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
  "row.channels_rich": "Channels: {list}",

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
  // Status bar messages (the log panel was removed)
  // -----------------------------------------------------------------
  "log.channels_changed": "{name} channel count set to {count}",

  // -----------------------------------------------------------------
  // Sidebar header row and master switch (Sidebar.tsx)
  // -----------------------------------------------------------------
  "side.menu": "Menu",
  "sb.speed": "Current speed",
  "sb.master_title": "Pause / resume all downloads",

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
  "bulk.done.paused": "{count} downloads paused",
  "bulk.done.resumed": "{count} downloads started",
  "bulk.done.cleared": "{count} records cleared",
  "bulk.done.cancelled": "{count} downloads cancelled",
  "bulk.none.paused": "No running downloads to pause",
  "bulk.none.resumed": "No resumable downloads",
  "bulk.none.cleared": "No records to clear",
  "bulk.none.cancelled": "No running downloads to cancel",

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
  "wizard.install": "Install the extension",
  "wizard.install_hint":
    "One click does everything: the extension files are copied, the {browser} extensions page opens, and the folder is shown selected in your file manager. On that page, turn on “Developer mode” in the top right and pick this folder with “Load unpacked”.",
  "wizard.bridge_off":
    "The browser bridge is not running. Check the port under Settings ▸ Browsers; the extension cannot deliver downloads without it.",
  "wizard.bridge_on": "The bridge is listening on 127.0.0.1:{port}.",
  "wizard.hint.connect":
    "The extension is loaded. Start a download in the browser and ADM will report the connection here.",
  "wizard.action.open_folder": "Open folder",
  "wizard.action.recheck": "Re-check connection",
  "wizard.working": "Preparing…",
  "wizard.prepared": "Extension files are ready",
  "wizard.connected": "{browser} connected",

  // -----------------------------------------------------------------
  // Safari — no file copy; install comes from the release page
  // -----------------------------------------------------------------
  "wizard.safari.lead":
    "The Safari extension cannot be installed by copying files; it ships as a separate app downloaded from the release page.",
  "wizard.safari.step1":
    "Download safari-unsigned-macos.zip from the release page.",
  "wizard.safari.step2":
    "Open the downloaded ADM.app. Because it is unsigned you may have to right-click it and choose \"Open\" on the first launch.",
  "wizard.safari.step3":
    "Turn ADM on under Safari ▸ Settings ▸ Extensions.",
  "wizard.safari.step4":
    "Enable Safari Develop ▸ Allow Unsigned Extensions; Safari asks for this permission on every launch.",
  "wizard.safari.download": "Open the release page",
  "wizard.safari.waiting":
    "Waiting for the connection — this line turns green once ADM is enabled in Safari.",
  "wizard.close": "Close",

  // -----------------------------------------------------------------
  // MC port — sidebar actions (Sidebar.tsx) + title bar settings button
  // -----------------------------------------------------------------
  "tb.start_queue": "Start Queue",
  "tb.stop_all": "Stop All",
  "tb.clear_done": "Clear Finished",
  "tb.settings": "Settings",
  "bulk.err.action": "The action failed: {error}",

  // -----------------------------------------------------------------
  // MC port — extra row labels (DownloadRow.tsx)
  // -----------------------------------------------------------------
  "row.kind_video": "Video",
  "row.kind_video_title": "Video downloaded with yt-dlp",
  "row.completed_sub": "Completed",

  // -----------------------------------------------------------------
  // MC port — download detail dialog (DownloadDetailDialog.tsx)
  // -----------------------------------------------------------------
  "detail.title": "Download Details",
  "detail.section.progress": "Progress",
  "detail.section.info": "Information",
  "detail.section.connections": "Connections",
  "detail.section.log": "yt-dlp Log",
  "detail.eta": "Left:",
  "detail.field.url": "Address",
  "detail.field.kind": "Type",
  "detail.field.ranges": "Partial download",
  "detail.field.channels": "Connections",
  "detail.field.added": "Added",
  "detail.field.finished": "Finished",
  "detail.field.headers": "Extra headers",
  "detail.kind.video": "Video (yt-dlp)",
  "detail.kind.file": "File",
  "detail.ranges.yes": "Supported",
  "detail.ranges.no": "Not supported",
  "detail.conn.no": "No.",
  "detail.conn.downloaded": "Downloaded",
  "detail.conn.start": "Start",
  "detail.conn.info": "Info",
  "detail.conn.finished": "Done",
  "detail.conn.percent": "{percent}%",
  "detail.log.empty": "No yt-dlp output yet.",
  "detail.close_on_finish": "Close this window when the download finishes",
  "detail.open": "Open File",
  "detail.show_in_folder": "Show in Folder",
  "detail.err.open": "Could not open the detail window: {error}",

  // -----------------------------------------------------------------
  // MC port — new download dialog (NewDownloadDialog.tsx)
  // -----------------------------------------------------------------
  "add.kind": "Download type",
  "add.kind_file": "File",
  "add.kind_video": "Video (yt-dlp)",
  "add.kind_file_hint": "A direct link, fetched by the multi-connection engine.",
  "add.kind_video_hint":
    "A video page, fetched with yt-dlp. Required for sites like YouTube.",
  "add.channels_field": "Connections",
  "add.channels_note": "Only used for file downloads.",

  // -----------------------------------------------------------------
  // MC port — clipboard prompt (ClipboardPromptDialog.tsx)
  // -----------------------------------------------------------------
  "clip.title": "Link found in the clipboard",
  "clip.body": "Download the {count} links from the clipboard?",
  "clip.body_one": "Download the link from the clipboard?",
  "clip.url_hint": "{url}",
  "clip.download_video": "Download Video (yt-dlp)",
  "clip.download_file": "Download as File",
  "clip.ignore": "Ignore",
  "clip.remember": "Don't ask again (this session)",

  // -----------------------------------------------------------------
  // MC port — external tool installation (tools.rs events)
  // -----------------------------------------------------------------
  "tool.working": "Preparing…",
  "tool.installed": "Installed ({version})",
  "tool.failed": "Installation failed: {error}",

  // -----------------------------------------------------------------
  // MC port — settings tabs (SettingsPanel.tsx)
  // -----------------------------------------------------------------
  "settings.tab.general": "General",
  "settings.tab.types": "File Types",
  "settings.tab.browsers": "Browsers",
  "settings.tab.video": "Video",
  "settings.tab.interface": "Interface",
  "settings.section.behaviour": "Behaviour",
  "settings.section.tray": "Tray icon and startup",
  "settings.section.updates": "Updates",
  "settings.max_concurrent": "Concurrent downloads",
  "settings.max_concurrent_hint":
    "How many downloads may run at once. The rest wait in the queue.",
  "settings.concurrent_value": "{count} downloads",
  "settings.auto_start": "Start new downloads immediately",
  "settings.auto_start_hint":
    "When off, new downloads wait in the queue and start with “Start Queue”.",
  "settings.notify": "Notify when a download finishes",
  "settings.notify_hint": "A Windows notification is shown when a download completes.",
  "settings.show_detail": "Open the detail window when a download starts",
  "settings.show_detail_hint":
    "Opens a small IDM-style popup where progress, speed and per-channel percentages can be watched. Open it manually from the row context menu with “Open in Separate Window”.",
  "settings.auto_close_detail": "Close the detail window when finished",
  "settings.auto_close_detail_hint":
    "This is the default of the “close on finish” checkbox in the detail window.",
  "settings.watch_clipboard": "Watch the clipboard",
  "settings.watch_clipboard_hint":
    "You are asked about suitable links copied to the clipboard.",
  "settings.organize": "Sort into category subfolders",
  "settings.organize_hint":
    "Files are written into a category folder (video/audio/other) instead of the general location.",
  "settings.start_in_tray": "Start in the tray",
  "settings.start_in_tray_hint":
    "The app starts with only a tray icon and no window.",
  "settings.close_to_tray": "Keep running in the background when closed",
  "settings.close_to_tray_hint":
    "Closing the window keeps the app running; use the tray menu to quit.",
  "settings.autostart": "Run at sign-in",
  "settings.autostart_hint": "ADM starts automatically when you sign in to Windows.",
  "settings.check_updates": "Check for updates on launch",
  "settings.check_updates_hint": "You are notified when a new version exists.",
  "settings.check_now": "Check now",
  "settings.check_now_title": "Check for an update right away",
  "settings.checking": "Checking…",
  "settings.update_current": "Version {version} — up to date.",
  "settings.update_available": "New version: {version}",
  "settings.update_error": "Could not check: {error}",
  "settings.update_last": "Last check: {time}",
  "settings.update_never": "Not checked yet",
  "settings.update_download": "Download the update",
  "settings.types_intro":
    "Only the extensions below are captured from the browser and the clipboard. Capture is off when no group is selected.",
  "settings.types_groups": "Built-in groups",
  "settings.types_custom": "Custom extensions",
  "settings.types_custom_hint":
    "Comma-separated extensions (e.g. torrent, parquet). The dot is optional.",
  "settings.types_custom_placeholder": "torrent, parquet",
  "settings.types_preview": "Active extensions ({count})",
  "settings.types_preview_empty": "No extension selected — capture is off.",
  "settings.browsers_intro":
    "ADM takes over downloads from the browser through a local bridge. Without the extension, downloads stay in the browser.",
  "settings.bridge_port": "Bridge port",
  "settings.bridge_port_hint":
    "ADM must be restarted after a change. Default: 48213.",
  "settings.bridge_running": "Listening on 127.0.0.1:{port}",
  "settings.bridge_stopped": "The bridge is not running",
  "settings.bridge_browsers": "Connected browsers: {browsers}",
  "settings.bridge_no_browser": "No browser has connected yet",
  "settings.plugin_folder": "Extension folder",
  "settings.plugin_folder_hint":
    "The extension files are copied into this folder; point the browser at it.",
  "settings.wizard_open": "Open the setup wizard",
  "settings.browser_ready": "Extension files are ready",
  "settings.browser_missing": "Extension files have not been copied yet",
  "settings.video_intro":
    "Video downloads use yt-dlp. Missing tools can be installed before a download starts.",
  "settings.site_login": "Site login",
  "settings.site_login_hint":
    "Sign in with your account for age-restricted or members-only videos; the cookies are handed to yt-dlp.",
  "settings.site_login_open": "Open the login window",
  "settings.site_login_save": "Save cookies and close",
  "settings.site_login_clear": "Delete the cookies",
  "settings.site_login_none": "No saved cookies.",
  "settings.site_login_count": "{count} cookies saved",
  "settings.site_login_domains": "Sites: {domains}",
  "settings.site_login_saved": "Cookies saved ({count})",
  "settings.tools": "External tools",
  "settings.tools_hint":
    "yt-dlp, ffmpeg and deno are downloaded from GitHub into the ADM folder.",
  "settings.tool_install": "Install",
  "settings.tool_reinstall": "Update",
  "settings.tool_installed": "Installed",
  "settings.tool_missing": "Not installed",
  "settings.tools_checking": "Checking…",
  "settings.tool_version": "version {version}",
  "settings.ytdlp_path": "Custom yt-dlp path",
  "settings.ytdlp_path_hint":
    "When empty, PATH and the ADM tools folder are used.",
  "settings.ytdlp_path_placeholder": "C:\\tools\\yt-dlp.exe",
  "settings.video_format": "Format selector",
  "settings.video_format_hint":
    "When empty, the resolution and container below are used. E.g. `bv*+ba/b`.",
  "settings.video_container": "Container",
  "settings.video_max_height": "Maximum resolution",
  "settings.format_preview": "Effective arguments",
  "settings.height.best": "Best",
  "settings.height.audio_m4a": "Audio only (m4a)",
  "settings.height.audio_mp3": "Audio only (mp3)",
  "settings.height.p": "{height}p",
  "settings.container.mp4": "MP4",
  "settings.container.mkv": "MKV",
  "settings.container.webm": "WebM",
  "settings.container.original": "Original format",
  "settings.section.dock": "Bottom panel",
  "settings.dock_graph": "Start with the speed graph open",
  "settings.dock_graph_hint": "It can also be opened with the ▾ button in the status bar.",
  "settings.dock_log": "Start with the events log open",
  "settings.dock_log_hint": "The last 300 events are kept in memory.",
  "settings.section.about": "Application",
  "settings.about_version": "Version {version}",
  "settings.about_hint": "Rust + Tauri 2 + SolidJS · SQLite (WAL) · TR/EN",

  // -----------------------------------------------------------------
  // MC port — store log lines
  // -----------------------------------------------------------------
  "log.bridge_connection": "Browser connection: {browser}",
  "log.browser_files_ready": "Extension files are ready: {path}",
  "log.tool_installed": "{tool} installed (version {version})",
  "log.update_available": "A new version is available: {version}",
  "log.update_current": "Version {version} is up to date",
  "log.update_failed": "Could not check for updates: {error}",
};
