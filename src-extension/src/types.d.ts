// ADM bridge extension — paylaşılan tipler.
// Bildirimler globaldir (`export` yok): giriş betikleri `import type` kullanmaz,
// böylece derleme çıktıları modül olmaktan çıkar — content script ve klasik MV3
// service worker `export`/`import` sözdizimini çalıştıramaz.

type MediaKind = 'hls' | 'dash' | 'media';

interface Settings {
  port: number;
  intercept: boolean;
  minSizeMB: number;
  sniff: boolean;
}

interface AppInfo {
  version: string;
  active: number;
  captureExtensions?: string[];
}

interface MediaInfo {
  url: string;
  type: string;
  size: number;
  kind: string;
  time: number;
  key?: string;
  name?: string;
}

interface PageMediaItem {
  url: string;
  type?: string;
  name?: string;
}

interface DownloadItem {
  id: string;
  name: string;
  url?: string;
  state: string;
  received: number;
  total: number;
  speed: number;
  stage?: string;
  error?: string;
}

interface CookieInfo {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  expirationDate: number;
}

interface StatusResponse {
  online: boolean;
  app: AppInfo | null;
  settings: Settings;
  clickIntercept: boolean;
  captureExtensions: string[];
}

/** Çerezlerin hangi depodan (normal / gizli / Firefox konteyneri) okunacağı. */
interface CookieContext {
  tabId?: number;
  incognito?: boolean;
  cookieStoreId?: string;
}

interface SendToAppPayload extends CookieContext {
  url: string;
  filename?: string;
  referer?: string;
  kind?: string;
}

interface SendToAppResult {
  ok: boolean;
  error?: string;
}

type ExtMessage =
  | { type: 'status' }
  | { type: 'getMedia'; tabId: number }
  | { type: 'downloads' }
  | { type: 'action'; id: string; action: string }
  | { type: 'download'; url: string; filename?: string; referer?: string; kind?: string; tabId?: number }
  | { type: 'setSettings'; settings: Partial<Settings> }
  | { type: 'pageMedia'; items: PageMediaItem[] };

// Firefox ve Safari `browser` küresini söz (promise) döndüren yüzeyle sunar.
// Chrome tarafı `chrome.*` tiplerinden gelir; bu arayüz yalnızca `browser`
// yollarında kullanılan, geri çağrı yerine söz bekleyen metotları temsil eder.
// `menus` Safari'de ve Firefox Android'de bulunmayabilir.
interface FirefoxApi {
  runtime: {
    getURL(path: string): string;
    sendMessage(message: ExtMessage): Promise<unknown>;
    onInstalled: { addListener(callback: () => void): void };
    onStartup?: { addListener(callback: () => void): void };
    onMessage: {
      addListener(
        callback: (
          message: ExtMessage,
          sender: chrome.runtime.MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | undefined,
      ): void;
    };
  };
  downloads: {
    search(query: { id: number }): Promise<chrome.downloads.DownloadItem[]>;
    removeFile(id: number): Promise<void>;
    pause(id: number): Promise<void>;
    resume(id: number): Promise<void>;
  };
  menus?: {
    create(createProperties: { id: string; title: string; contexts: string[] }): void;
    removeAll(): Promise<void>;
    onClicked: {
      addListener(callback: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void): void;
    };
  };
}
