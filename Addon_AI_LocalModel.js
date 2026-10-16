/**
 * Local AI addon for ivLyrics
 * Runs a dedicated translation model (Tencent Hy-MT2 1.8B GGUF) on this device
 * through wllama (llama.cpp WebAssembly with WebGPU). The model only translates,
 * so this provider never generates pronunciation. The UI shows quality tiers
 * instead of model or file names.
 *
 * @author default
 * @version 1.0.0
 */

(() => {
    'use strict';

    const ADDON_ID = 'local-ai';
    const WLLAMA_VERSION = '3.8.1';
    const WLLAMA_CDN = `https://cdn.jsdelivr.net/npm/@wllama/wllama@${WLLAMA_VERSION}`;
    const MODEL_BASE_URL = 'https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main/';
    // Quality tiers, lightest first; each maps to one quantization of the same model.
    const QUALITY_TIERS = Object.freeze([
        Object.freeze({ id: 'light', labelKey: 'tierLight', fallback: 'Local Light', file: 'Hy-MT2-1.8B-Q4_K_M.gguf', size: 1133080448 }),
        Object.freeze({ id: 'medium', labelKey: 'tierMedium', fallback: 'Local Medium', file: 'Hy-MT2-1.8B-Q6_K.gguf', size: 1474785120 }),
        Object.freeze({ id: 'high', labelKey: 'tierHigh', fallback: 'Local High', file: 'Hy-MT2-1.8B-Q8_0.gguf', size: 1908528192 }),
    ]);
    const DEFAULT_QUALITY = 'high';
    const IDLE_UNLOAD_OPTIONS = Object.freeze([10, 30, 60, 0]);
    const DEFAULT_IDLE_UNLOAD_MINUTES = 10;
    // Lines translated together keep their lyric context; small blocks keep the
    // first result quick and stay far below the 4096-token context.
    const BLOCK_MAX_LINES = 8;
    const BLOCK_MAX_CHARACTERS = 480;
    // The manager abandons a provider call after 95 s; stop starting new work
    // before that so an abandoned request never keeps the engine busy.
    const JOB_BUDGET_MS = 90_000;
    const LOAD_PARAMS = Object.freeze({ n_ctx: 4096, n_batch: 512, n_ubatch: 512, n_parallel: 1, jinja: true, ctx_shift: false });
    // Sampling recommended for Hy-MT2 1.8B by the model card.
    const SAMPLING = Object.freeze({ temperature: 0.7, top_p: 0.6, top_k: 20, penalty_repeat: 1.05 });
    const PROTECTED_PART_PATTERN = /^\s*\[.*\]\s*$/;
    // Hy-MT2 prompts use full English language names.
    const TARGET_LANGUAGE_NAMES = Object.freeze({
        ko: 'Korean', en: 'English', ja: 'Japanese', zh: 'Chinese', 'zh-cn': 'Chinese', 'zh-hans': 'Chinese', 'zh-sg': 'Chinese',
        'zh-tw': 'Traditional Chinese', 'zh-hk': 'Traditional Chinese', 'zh-hant': 'Traditional Chinese',
        es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', ru: 'Russian', pt: 'Portuguese',
        hi: 'Hindi', ar: 'Arabic', fa: 'Persian', bn: 'Bengali', cs: 'Czech', th: 'Thai', tr: 'Turkish',
        vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay', pl: 'Polish', nl: 'Dutch', uk: 'Ukrainian',
        he: 'Hebrew', tl: 'Filipino', fil: 'Filipino', km: 'Khmer', my: 'Burmese', gu: 'Gujarati',
        ur: 'Urdu', te: 'Telugu', mr: 'Marathi', ta: 'Tamil', bo: 'Tibetan', kk: 'Kazakh',
        mn: 'Mongolian', ug: 'Uyghur', yue: 'Cantonese',
    });

    const ADDON_INFO = {
        id: ADDON_ID,
        name: 'Local AI',
        author: 'default',
        description: {
            ko: '이 기기에서 직접 실행되는 번역 전용 로컬 AI입니다. API 키가 필요 없고 가사가 외부로 전송되지 않습니다.',
            en: 'Translation-only AI that runs locally on this device. No API key needed, and lyrics never leave your device.',
            ja: 'このデバイス上で動作する翻訳専用のローカルAIです。APIキーは不要で、歌詞がお使いのデバイスの外に送信されることはありません。',
            'zh-CN': '在此设备上运行的翻译专用本地 AI。无需 API 密钥，歌词绝不会离开您的设备。',
            'zh-TW': '在此裝置上執行的翻譯專用本機 AI。不需要 API 金鑰，歌詞絕不會離開您的裝置。',
            es: 'IA local solo para traducción que se ejecuta en este dispositivo. No necesita clave de API y las letras nunca salen de tu dispositivo.',
            fr: 'IA locale dédiée à la traduction, exécutée sur cet appareil. Aucune clé API requise, et les paroles ne quittent jamais votre appareil.',
            de: 'Lokale KI nur für Übersetzungen, die direkt auf diesem Gerät läuft. Kein API-Schlüssel nötig, und Songtexte verlassen nie Ihr Gerät.',
            it: 'AI locale solo per la traduzione, eseguita su questo dispositivo. Non serve alcuna chiave API e i testi non lasciano mai il tuo dispositivo.',
            ru: 'Локальный ИИ только для перевода, работающий прямо на этом устройстве. Ключ API не нужен, а тексты песен никогда не покидают ваше устройство.',
            sv: 'Lokal AI enbart för översättning som körs på den här enheten. Ingen API-nyckel behövs, och låttexterna lämnar aldrig din enhet.',
            pt: 'IA local só para tradução, executada neste dispositivo. Não precisa de chave de API, e as letras nunca saem do seu dispositivo.',
            hi: 'केवल अनुवाद के लिए बना स्थानीय AI, जो इसी डिवाइस पर चलता है। किसी API कुंजी की ज़रूरत नहीं, और लिरिक्स कभी आपके डिवाइस से बाहर नहीं जाते।',
            ar: 'ذكاء اصطناعي محلي للترجمة فقط يعمل على هذا الجهاز. لا يحتاج إلى مفتاح API، ولا تغادر كلمات الأغاني جهازك أبدًا.',
            fa: 'هوش مصنوعی محلی ویژهٔ ترجمه که روی همین دستگاه اجرا می‌شود. به کلید API نیازی نیست و متن ترانه‌ها هرگز از دستگاه شما خارج نمی‌شود.',
            bn: 'এই ডিভাইসে চলা, শুধু অনুবাদের জন্য তৈরি স্থানীয় এআই। কোনো API কী লাগে না, এবং লিরিক্স কখনও আপনার ডিভাইসের বাইরে যায় না।',
            cs: 'Místní AI pouze pro překlad, která běží přímo v tomto zařízení. Nepotřebuje klíč API a texty písní nikdy neopustí vaše zařízení.',
            th: 'AI ในเครื่องสำหรับการแปลโดยเฉพาะ ซึ่งทำงานบนอุปกรณ์นี้ ไม่ต้องใช้คีย์ API และเนื้อเพลงจะไม่ถูกส่งออกไปนอกอุปกรณ์ของคุณ',
            tr: 'Bu cihazda çalışan, yalnızca çeviri için yerel yapay zeka. API anahtarı gerekmez ve şarkı sözleri cihazınızdan asla çıkmaz.',
            vi: 'AI cục bộ chỉ dùng để dịch, chạy ngay trên thiết bị này. Không cần khóa API và lời bài hát không bao giờ rời khỏi thiết bị của bạn.',
            id: 'AI lokal khusus terjemahan yang berjalan di perangkat ini. Tanpa kunci API, dan lirik tidak pernah keluar dari perangkat Anda.',
            ms: 'AI setempat khusus untuk terjemahan yang berjalan pada peranti ini. Tiada kunci API diperlukan, dan lirik tidak pernah keluar dari peranti anda.'
        },
        version: '1.0.0',
        supports: {
            translate: true,
            pronunciation: false,
            metadata: false,
            tmi: false,
            lyricsStudy: false,
            characterPronunciation: false,
            culturalAnnotations: false,
            wordSupplements: false
        }
    };

    // ============================================
    // Helpers
    // ============================================

    const formatText = (value, params) => (params
        ? String(value).replace(/\{(\w+)\}/g, (match, name) => (params[name] !== undefined ? String(params[name]) : match))
        : String(value));

    function t(key, fallback, params) {
        let value = '';
        try {
            value = window.I18n?.t?.(`settings.aiProviders.localModel.${key}`, params) || '';
        } catch {
            value = '';
        }
        return formatText(value || fallback, params);
    }

    const getSetting = (key, fallback) => {
        try {
            const value = window.AIAddonManager?.getAddonSetting?.(ADDON_ID, key, fallback);
            return value === undefined || value === null ? fallback : value;
        } catch {
            return fallback;
        }
    };
    const setSetting = (key, value) => window.AIAddonManager?.setAddonSetting?.(ADDON_ID, key, value);

    const getQualityTier = () => QUALITY_TIERS.find((tier) => tier.id === getSetting('quality', DEFAULT_QUALITY))
        || QUALITY_TIERS.find((tier) => tier.id === DEFAULT_QUALITY);
    const getModelUrl = (tier = getQualityTier()) => MODEL_BASE_URL + tier.file;
    const tierLabel = (tier) => t(tier.labelKey, tier.fallback);
    const getDevicePreference = () => (getSetting('device', 'auto') === 'cpu' ? 'cpu' : 'auto');
    const getIdleUnloadMinutes = () => {
        const minutes = Number(getSetting('idle-unload-minutes', DEFAULT_IDLE_UNLOAD_MINUTES));
        return IDLE_UNLOAD_OPTIONS.includes(minutes) ? minutes : DEFAULT_IDLE_UNLOAD_MINUTES;
    };
    const formatGigabytes = (bytes) => `${(bytes / 1e9).toFixed(2)}GB`;
    // Raw error text (URLs, file names) only feeds the debug log and error classification.
    const rawText = (error) => String(error?.message || error || '');

    function languageLabel(lang) {
        try {
            return new Intl.DisplayNames([window.I18n?.getCurrentLanguage?.() || 'en'], { type: 'language' }).of(lang) || lang;
        } catch {
            return lang;
        }
    }

    function targetLanguageName(lang) {
        const code = String(lang || 'en').trim().replace(/_/g, '-').toLowerCase();
        return TARGET_LANGUAGE_NAMES[code] || TARGET_LANGUAGE_NAMES[code.split('-')[0]] || null;
    }

    const unsupportedLanguageText = (lang) => t('unsupportedLanguage', 'The local model cannot translate into {language}.', { language: languageLabel(lang) });

    function resolveTargetLanguage(lang) {
        const name = targetLanguageName(lang);
        if (!name) throw localError('unsupportedLanguage', unsupportedLanguageText(lang));
        return name;
    }

    // The language lyrics are translated into, resolved the way the app resolves it.
    function getCurrentTargetLanguage() {
        let configured = window.CONFIG?.visual?.['translate:target-language'];
        if (!configured) {
            try {
                configured = window.localStorage?.getItem?.('ivLyrics:visual:translate:target-language') || null;
            } catch {
                configured = null;
            }
        }
        return configured && configured !== 'auto' ? configured : (window.I18n?.getCurrentLanguage?.() || 'en');
    }

    // ============================================
    // Errors: people read a short localized explanation; engine and network
    // details (URLs, file names) only go to the debug log.
    // ============================================

    function localError(kind, message, extra) {
        const error = new Error(message);
        error.localModelKind = kind;
        if (extra) Object.assign(error, extra);
        return error;
    }

    function logDetail(context, error) {
        try {
            if (typeof window.__ivLyricsDebugLog === 'function') {
                window.__ivLyricsDebugLog(`[Local AI] ${context}:`, error);
            } else {
                console.warn(`[Local AI] ${context}:`, rawText(error));
            }
        } catch {
            // Logging must never break the provider.
        }
    }

    function classifyFailure(error, stage) {
        if (error?.localModelKind) return { kind: error.localModelKind, status: error.httpStatus };
        const name = String(error?.name || '');
        const text = rawText(error);
        if (name === 'AbortError') return { kind: 'cancelled' };
        if (name === 'TimeoutError') return { kind: 'timeout' };
        // wllama reports a refused download as "Failed to fetch <url>: HTTP <status>".
        const http = text.match(/\bHTTP\s*(\d{3})\b/i);
        if (http) return { kind: 'http', status: Number(http[1]) };
        if (name === 'QuotaExceededError' || /quota|no space|not enough (?:disk |storage )?space|disk (?:is )?full/i.test(text)) {
            return { kind: 'storage' };
        }
        if (/out of memory|\boom\b|could not allocate|allocation failed|cannot enlarge memory/i.test(text)) return { kind: 'memory' };
        if (/webgpu|\bgpu\b|device (?:was )?lost/i.test(text)) return { kind: 'webgpu' };
        const network = /failed to fetch|network ?error|load failed/i.test(text);
        // The model itself is local, so a failed fetch while loading means the engine files.
        if (stage === 'engine' || (stage === 'load' && network) || /dynamically imported module|webassembly|\bwasm\b/i.test(text)) {
            return { kind: 'engine' };
        }
        if (network || (stage === 'download' && name === 'TypeError')) return { kind: 'network' };
        return { kind: stage === 'load' ? 'load' : 'unknown' };
    }

    function failureMessage(kind, status) {
        switch (kind) {
            case 'network':
                return t('errorNetwork', "Couldn't connect to the download server. Check your internet connection and try again.");
            case 'http':
                if (status === 429 || status === 503) {
                    return t('errorHttpBusy', 'The download server is busy right now (HTTP {status}). Wait a few minutes, then try again.', { status });
                }
                if (status === 401 || status === 403) {
                    return t('errorHttpBlocked', 'The download server refused the request (HTTP {status}). Try again later, or turn off any VPN or proxy you use.', { status });
                }
                return t('errorHttp', 'The download server returned an error (HTTP {status}). Try again later.', { status });
            case 'storage':
                return t('errorStorage', "There isn't enough storage space for the model. Free up disk space or choose a lighter quality, then try again.");
            case 'engine':
                return t('errorEngine', "The translation engine couldn't be loaded. Check your internet connection and try again.");
            case 'load':
                return t('errorLoad', "The model couldn't be loaded. Delete it and download it again.");
            case 'memory':
                return t('errorMemory', "There isn't enough memory to run the model. Close other apps or choose a lighter quality, then try again.");
            case 'webgpu':
                return t('errorWebGpu', 'The graphics processor (WebGPU) stopped responding. Try again, or set Processor to CPU only.');
            case 'timeout':
                return t('errorTimeout', 'Translation took too long on this device and was stopped. A lighter quality translates faster.');
            default:
                return t('errorUnknown', 'Something went wrong with the local model. Try again.');
        }
    }

    // Turns any failure into an error whose message is safe to show.
    function friendlyError(error, stage) {
        if (error?.localModelKind) return error;
        const { kind, status } = classifyFailure(error, stage);
        logDetail(`${stage} failed`, error);
        const extra = status ? { httpStatus: status } : {};
        if (kind === 'timeout') extra.name = 'TimeoutError';
        if (kind === 'cancelled') extra.name = 'AbortError';
        return localError(kind, failureMessage(kind, status), extra);
    }

    const timeoutError = () => localError('timeout', failureMessage('timeout'), { name: 'TimeoutError' });
    const cancelledError = () => localError('cancelled', failureMessage('cancelled'), { name: 'AbortError' });
    // Lets the manager tell a stopped request from a failure: nobody waits for that song any more.
    const supersededError = () => localError('superseded',
        t('errorSuperseded', 'This translation was stopped because a newer song needs the local model.'),
        { name: 'AbortError', superseded: true });

    // ============================================
    // Status shared by the settings card and the engine
    // ============================================

    const state = { phase: 'unknown', loadedBytes: 0, totalBytes: 0, device: null, error: null, downloadedTiers: [] };
    const listeners = new Set();
    // Every phase change bumps the version, so a slower status check never
    // overwrites newer work. A soft update is only a guess the check may correct.
    let statusVersion = 0;
    function setState(patch, { soft = false } = {}) {
        if (!soft && 'phase' in patch) statusVersion++;
        Object.assign(state, patch);
        const snapshot = { ...state };
        for (const listener of listeners) {
            try { listener(snapshot); } catch { /* A closed settings card must not break the engine. */ }
        }
    }
    const subscribe = (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    };

    // ============================================
    // Engine
    // ============================================

    let wllamaModulePromise = null;
    let engine = null;
    let loadedModelUrl = null;
    let loadPromise = null;
    // The download in progress ({ url, controller, promise }); there is never more than one.
    let activeDownload = null;
    let webGpuAvailable = null;
    let idleTimer = null;

    const importModule = (url) => (typeof window.__ivLyricsLocalModelImport === 'function'
        ? window.__ivLyricsLocalModelImport(url)
        : import(url));

    function loadWllamaModule() {
        if (!wllamaModulePromise) {
            wllamaModulePromise = Promise.resolve()
                .then(() => importModule(`${WLLAMA_CDN}/esm/index.js`))
                .catch((error) => {
                    wllamaModulePromise = null;
                    throw friendlyError(error, 'engine');
                });
        }
        return wllamaModulePromise;
    }

    // One Wllama instance manages the model cache (OPFS) and, once loaded, runs inference.
    async function getEngine() {
        if (engine) return engine;
        const { Wllama } = await loadWllamaModule();
        if (!engine) {
            try {
                engine = new Wllama({ default: `${WLLAMA_CDN}/src/wasm/wllama.wasm` }, {
                    suppressNativeLog: true,
                    logger: {
                        debug() {},
                        log() {},
                        warn: (...args) => console.warn('[Local AI]', ...args),
                        error: (...args) => console.error('[Local AI]', ...args)
                    }
                });
            } catch (error) {
                throw friendlyError(error, 'engine');
            }
        }
        return engine;
    }

    // Only finished downloads are models to wllama: it writes a file's metadata
    // after the last byte and skips files without metadata.
    const listModels = (instance) => instance.modelManager.getModels({ includeInvalid: true });

    async function listCachedModels() {
        return listModels(await getEngine());
    }

    async function findCachedModel(url = getModelUrl()) {
        const models = await listCachedModels();
        return models.find((model) => model.url === url) || null;
    }

    const isValidModel = (model) => !!model && model.validate() === 'valid';
    const isBusy = () => !!activeDownload || !!loadPromise || state.phase === 'downloading' || state.phase === 'loading';

    async function refreshStatus() {
        const version = ++statusVersion;
        if (isBusy()) return { ...state };
        const tier = getQualityTier();
        try {
            const models = await listCachedModels();
            // A download, a model load or a newer check may have started while the
            // cache was being read; that work owns the status now.
            if (version !== statusVersion || isBusy()) return { ...state };
            const downloadedTiers = QUALITY_TIERS
                .filter((candidate) => isValidModel(models.find((model) => model.url === getModelUrl(candidate))))
                .map((candidate) => candidate.id);
            const loaded = engine?.isModelLoaded?.() && loadedModelUrl === getModelUrl(tier);
            setState({
                phase: loaded ? 'ready' : (downloadedTiers.includes(tier.id) ? 'downloaded' : 'missing'),
                totalBytes: tier.size,
                downloadedTiers,
                error: null,
                ...(loaded ? {} : { device: null })
            });
        } catch (error) {
            const failure = friendlyError(error, 'cache');
            if (version === statusVersion && !isBusy()) setState({ phase: 'error', error: failure.message });
        }
        return { ...state };
    }

    async function hasWebGpu() {
        if (webGpuAvailable !== null) return webGpuAvailable;
        try {
            webGpuAvailable = Boolean(await navigator.gpu?.requestAdapter?.({ powerPreference: 'high-performance' }));
        } catch {
            webGpuAvailable = false;
        }
        return webGpuAvailable;
    }

    async function exitEngine(instance) {
        if (!instance) return;
        let timer = null;
        try {
            await Promise.race([
                instance.exit(),
                new Promise((resolve) => { timer = setTimeout(resolve, 5000); })
            ]);
        } catch (error) {
            console.warn('[Local AI] Failed to release the engine:', rawText(error));
        } finally {
            if (timer !== null) clearTimeout(timer);
        }
    }

    async function unloadModel() {
        clearIdleTimer();
        const instance = engine;
        engine = null;
        loadedModelUrl = null;
        await exitEngine(instance);
        if (state.phase === 'ready' || state.phase === 'loading') {
            // After a quality change the pending status check knows better.
            setState({ phase: 'downloaded', device: null }, { soft: true });
        }
    }

    function ensureLoaded() {
        const url = getModelUrl();
        if (engine?.isModelLoaded?.() && loadedModelUrl === url) return Promise.resolve(engine);
        if (activeDownload || state.phase === 'downloading') {
            // The download shares the engine instance; leave it and its status untouched.
            return Promise.reject(localError('busy', t('downloadBusy', 'Wait for the model download to finish, then try again.')));
        }
        if (loadPromise) return loadPromise;
        loadPromise = (async () => {
            if (engine?.isModelLoaded?.()) await unloadModel();
            const model = await findCachedModel(url);
            if (!isValidModel(model)) {
                setState({ phase: 'missing', device: null });
                throw localError('notReady', t('notReady', 'The local model is not ready yet. Download it first in Settings > AI Providers > Local AI.'));
            }
            setState({ phase: 'loading', error: null });
            const useGpu = getDevicePreference() === 'auto' && await hasWebGpu();
            let usedGpu = useGpu;
            try {
                await (await getEngine()).loadModel(model, { ...LOAD_PARAMS, n_gpu_layers: useGpu ? 99999 : 0 });
            } catch (error) {
                if (!useGpu) throw error;
                // A WebGPU failure on this adapter still leaves the slower CPU path.
                console.warn('[Local AI] WebGPU load failed; retrying on the CPU:', rawText(error));
                const failed = engine;
                engine = null;
                await exitEngine(failed);
                await (await getEngine()).loadModel(model, { ...LOAD_PARAMS, n_gpu_layers: 0 });
                usedGpu = false;
            }
            if (!engine.getChatTemplate?.()) {
                throw new Error('[Local AI] The model has no chat template.');
            }
            loadedModelUrl = url;
            setState({ phase: 'ready', device: usedGpu ? 'WebGPU' : 'CPU', error: null });
            return engine;
        })().catch(async (error) => {
            const failure = friendlyError(error, 'load');
            const keepPhase = state.phase === 'missing';
            const failed = engine;
            engine = null;
            loadedModelUrl = null;
            await exitEngine(failed);
            if (!keepPhase) setState({ phase: 'error', device: null, error: failure.message });
            throw failure;
        }).finally(() => {
            loadPromise = null;
        });
        return loadPromise;
    }

    // Deleting by URL also removes a file whose download never finished; the
    // model list (and Model.remove) only know files that have metadata.
    async function deleteCachedFile(instance, url, model = null) {
        const cache = instance?.modelManager?.cacheManager;
        if (typeof cache?.delete === 'function') {
            await cache.delete(url);
        } else if (model) {
            await model.remove();
        }
    }

    async function removeUnfinishedDownload(instance, url) {
        try {
            const models = await listModels(instance);
            if (isValidModel(models.find((model) => model.url === url))) return;
            await deleteCachedFile(instance, url);
        } catch (error) {
            logDetail('Could not remove an unfinished download', error);
        }
    }

    function downloadModel() {
        // Another click (or a second settings card) joins the download already running.
        if (activeDownload) return activeDownload.promise;
        const tier = getQualityTier();
        const url = getModelUrl(tier);
        const controller = new AbortController();
        const download = { url, controller, promise: null };
        const finish = (patch) => {
            if (activeDownload === download) activeDownload = null;
            setState(patch);
        };
        const stopIfCancelled = () => {
            if (controller.signal.aborted) throw cancelledError();
        };
        activeDownload = download;
        setState({ phase: 'downloading', loadedBytes: 0, totalBytes: tier.size, error: null });
        download.promise = (async () => {
            let instance = null;
            let lastUpdate = 0;
            try {
                instance = await getEngine();
                stopIfCancelled();
                if (!isValidModel(await findCachedModel(url))) {
                    stopIfCancelled();
                    await instance.modelManager.downloadModel({ url }, {
                        signal: controller.signal,
                        progressCallback: ({ loaded, total }) => {
                            if (controller.signal.aborted) return;
                            const now = Date.now();
                            if (now - lastUpdate < 250 && loaded < total) return;
                            lastUpdate = now;
                            setState({ loadedBytes: loaded, totalBytes: total > 0 ? total : tier.size });
                        }
                    });
                }
            } catch (error) {
                const cancelled = controller.signal.aborted || error?.name === 'AbortError';
                const failure = cancelled ? null : friendlyError(error, 'download');
                // wllama leaves the partial file of a cancelled or failed download behind.
                if (instance) await removeUnfinishedDownload(instance, url);
                if (cancelled) {
                    finish({ phase: 'missing', loadedBytes: 0, error: null });
                    return;
                }
                finish({ phase: 'error', loadedBytes: 0, error: failure.message });
                throw failure;
            }
            const downloadedTiers = QUALITY_TIERS.map((candidate) => candidate.id)
                .filter((id) => id === tier.id || state.downloadedTiers.includes(id));
            finish({
                phase: downloadedTiers.includes(getQualityTier().id) ? 'downloaded' : 'missing',
                loadedBytes: tier.size, totalBytes: tier.size, downloadedTiers, error: null
            });
        })();
        return download.promise;
    }

    const cancelDownload = () => activeDownload?.controller.abort();

    async function removeModel() {
        if (activeDownload) {
            throw localError('busy', t('downloadBusy', 'Wait for the model download to finish, then try again.'));
        }
        await unloadModel();
        const tier = getQualityTier();
        const instance = await getEngine();
        const models = await listModels(instance);
        const modelOf = (candidate) => models.find((model) => model.url === getModelUrl(candidate)) || null;
        await deleteCachedFile(instance, getModelUrl(tier), modelOf(tier));
        // Partial files from interrupted downloads of every quality go too;
        // finished downloads of the other qualities stay.
        for (const candidate of QUALITY_TIERS) {
            if (candidate.id === tier.id || isValidModel(modelOf(candidate))) continue;
            try {
                await deleteCachedFile(instance, getModelUrl(candidate), modelOf(candidate));
            } catch (error) {
                logDetail('Could not remove an unfinished download', error);
            }
        }
        setState({
            phase: 'missing', loadedBytes: 0, device: null, error: null,
            downloadedTiers: state.downloadedTiers.filter((id) => id !== tier.id)
        });
    }

    // ============================================
    // Scheduler: one model, so requests share it, one block at a time. Settings
    // actions run first, then the song that is playing, then lyrics on screen,
    // then prefetching for upcoming songs. A newer song stops older work for
    // songs nobody is looking at any more.
    // ============================================

    const queue = [];
    const jobs = new Set();
    let pumping = false;

    function clearIdleTimer() {
        if (idleTimer !== null) clearTimeout(idleTimer);
        idleTimer = null;
    }

    function scheduleIdleUnload() {
        clearIdleTimer();
        const minutes = getIdleUnloadMinutes();
        if (!minutes || !engine?.isModelLoaded?.()) return;
        idleTimer = setTimeout(() => {
            idleTimer = null;
            if (!pumping && !queue.length) void unloadModel();
        }, minutes * 60_000);
    }

    // Requests carry their song's translation cache id; compare it with the song playing now.
    function getPlayingTrackId() {
        try {
            const player = (typeof Spicetify !== 'undefined' ? Spicetify : window.Spicetify)?.Player;
            const uri = player?.data?.item?.uri;
            if (!uri) return null;
            const identity = [window.ivLyricsTrackIdentity, window.LyricsService, window.Utils]
                .find((candidate) => typeof candidate?.getTranslationCacheId === 'function');
            return identity?.getTranslationCacheId(uri) || null;
        } catch {
            return null;
        }
    }

    // kind 'lyrics' is a request from the app; 'test' is the settings card's test translation.
    function startJob({ kind, trackId = null, text = '', onScreen = false }) {
        const controller = new AbortController();
        let rejectStopped = null;
        const whenStopped = new Promise((_, reject) => { rejectStopped = reject; });
        whenStopped.catch(() => {});
        const id = trackId ? String(trackId) : null;
        const job = {
            kind,
            onScreen,
            trackId: id,
            // Lyrics on screen without a track id are told apart by their text.
            identity: id ? `track:${id}` : (onScreen ? `text:${text}` : null),
            signal: controller.signal,
            stopped: false,
            stopReason: null,
            // Set by the first failed block, so the request's other blocks skip the engine.
            failure: null,
            whenStopped,
            stop(reason) {
                if (job.stopped) return;
                job.stopped = true;
                job.stopReason = reason;
                rejectStopped(reason);
                // Blocks that have not started are dropped; the running one is aborted.
                dropQueuedBlocks(job, reason);
                controller.abort();
            }
        };
        if (kind === 'lyrics') stopSupersededJobs(job);
        jobs.add(job);
        return job;
    }

    function dropQueuedBlocks(job, reason) {
        for (let index = queue.length - 1; index >= 0; index--) {
            if (queue[index].job === job) queue.splice(index, 1)[0].reject(reason);
        }
    }

    function stopSupersededJobs(job) {
        if (!job.identity) return;
        const playingTrackId = getPlayingTrackId();
        // A request without a line callback is either another view of the playing
        // song or a prefetch for an upcoming one. Only a prefetch replaces older
        // prefetches, and only when it is certain which song is playing.
        if (!job.onScreen && (!playingTrackId || job.trackId === playingTrackId)) return;
        for (const other of jobs) {
            if (other.kind !== 'lyrics' || other.onScreen !== job.onScreen) continue;
            if (!other.identity || other.identity === job.identity) continue;
            // The playing song's translation is never stopped.
            if (playingTrackId && other.trackId === playingTrackId) continue;
            other.stop(supersededError());
        }
    }

    const finishJob = (job) => jobs.delete(job);

    function priorityOf(entry, playingTrackId) {
        const { job } = entry;
        if (!job) return 0;
        // The settings card's test is a single line someone is waiting for.
        if (job.kind === 'test') return 1;
        if (playingTrackId && job.trackId === playingTrackId) return 2;
        return job.onScreen ? 3 : 4;
    }

    function takeNextTask() {
        if (!queue.length) return null;
        const playingTrackId = queue.length > 1 ? getPlayingTrackId() : null;
        let best = 0;
        for (let index = 1; index < queue.length; index++) {
            if (priorityOf(queue[index], playingTrackId) < priorityOf(queue[best], playingTrackId)) best = index;
        }
        return queue.splice(best, 1)[0];
    }

    // Settings actions pass no job and run before any translation work.
    function runTask(task, job = null) {
        if (job?.stopped) return Promise.reject(job.stopReason);
        return new Promise((resolve, reject) => {
            queue.push({ task, job, resolve, reject });
            void pump();
        });
    }

    async function pump() {
        if (pumping) return;
        pumping = true;
        clearIdleTimer();
        try {
            for (let next = takeNextTask(); next; next = takeNextTask()) {
                try {
                    next.resolve(await next.task());
                } catch (error) {
                    next.reject(error);
                }
            }
        } finally {
            pumping = false;
            scheduleIdleUnload();
        }
    }

    // ============================================
    // Translation
    // ============================================

    const buildLinePrompt = (text, language) => `Translate the following text into ${language}. Note that you should only output the translated result without any additional explanation:\n\n${text}`;
    const buildBlockPrompt = (lines, language) => `Please accurately translate the following text into ${language}.\nYou must retain the exact same number of delimiters in the translation. Strictly do not omit, escape, or translate these symbols, and pay close attention to their placement.\n\n${lines.join('\n')}`;
    const outputBudget = (text) => Math.min(1536, 48 + Math.ceil(String(text).length * 3));

    // wllama 3.8.1 forwards llama.cpp's final streaming timings. predicted_ms
    // measures generation separately from prompt_ms; neither loading nor queueing is included.
    function completionPerformance(timings) {
        const tokens = timings?.predicted_n;
        const milliseconds = timings?.predicted_ms;
        if (!Number.isSafeInteger(tokens) || tokens <= 0 || !Number.isFinite(milliseconds) || milliseconds <= 0) return null;
        const seconds = milliseconds / 1000;
        const tokensPerSecond = tokens / seconds;
        return Number.isFinite(tokensPerSecond) ? { tokens, seconds, tokensPerSecond } : null;
    }

    async function complete(instance, prompt, maxTokens, signal) {
        if (signal?.aborted) throw cancelledError();
        let text = '';
        let finishReason = null;
        let performance = null;
        await instance.createChatCompletion({
            messages: [{ role: 'user', content: prompt }],
            max_tokens: maxTokens,
            ...SAMPLING,
            stream: true,
            stream_options: { include_usage: true },
            // Lets a song nobody waits for any more give the engine back mid-block.
            abortSignal: signal,
            onData(chunk) {
                const choice = chunk?.choices?.[0];
                if (typeof choice?.delta?.content === 'string') text += choice.delta.content;
                if (choice?.finish_reason) finishReason = choice.finish_reason;
                // The usage/timings-only final chunk can have an empty choices array.
                if (chunk?.timings) performance = completionPerformance(chunk.timings);
            }
        });
        if (signal?.aborted) throw cancelledError();
        return { text, finishReason, performance };
    }

    async function translateBlock(instance, parts, language, signal, onPerformance) {
        if (parts.length > 1) {
            const { text, finishReason } = await complete(instance, buildBlockPrompt(parts, language), outputBudget(parts.join('\n')), signal);
            const lines = text.replace(/\r\n?/g, '\n').trim().split('\n').map((line) => line.trim());
            if (finishReason !== 'length' && lines.length === parts.length && lines.every(Boolean)) return lines;
        }
        // The block lost or merged a line: translate each line on its own instead.
        const translated = [];
        for (const part of parts) {
            const { text, performance } = await complete(instance, buildLinePrompt(part, language), outputBudget(part), signal);
            const line = text.replace(/\s*\n+\s*/g, ' ').trim();
            if (!line) throw new Error('[Local AI] The model returned an empty line.');
            onPerformance?.(performance);
            translated.push(line);
        }
        return translated;
    }

    function buildBlocks(parts) {
        const blocks = [];
        let block = [];
        let characters = 0;
        for (const part of parts) {
            if (block.length && (block.length >= BLOCK_MAX_LINES || characters + part.length > BLOCK_MAX_CHARACTERS)) {
                blocks.push(block);
                block = [];
                characters = 0;
            }
            block.push(part);
            characters += part.length + 1;
        }
        if (block.length) blocks.push(block);
        return blocks;
    }

    const isTranslatablePart = (part) => !!part.trim() && !PROTECTED_PART_PATTERN.test(part);
    // wllama names its runtime errors 'RuntimeError', like WebAssembly traps.
    const needsFreshEngine = (error) => error?.name === 'RuntimeError' || error?.name === 'WllamaRuntimeError'
        || /out of memory|memory access|device (?:was )?lost/i.test(rawText(error));

    async function translateLyricsLines(text, language, onLine, job) {
        const deadline = Date.now() + JOB_BUDGET_MS;
        const sourceLines = String(text).replace(/\r\n?/g, '\n').split('\n');
        // Simultaneous vocal parts share a line as "a / b" and are translated separately.
        const rows = sourceLines.map((line) => line.split(' / '));
        const translations = new Map();
        const pending = [];
        for (const parts of rows) {
            for (const part of parts) {
                const key = part.trim();
                if (!isTranslatablePart(part) || translations.has(key)) continue;
                translations.set(key, null);
                pending.push(key);
            }
        }

        const rowText = (row) => rows[row].map((part) => {
            if (!part.trim()) return '';
            return isTranslatablePart(part) ? translations.get(part.trim()) : part;
        }).join(' / ');
        const emitted = new Array(rows.length).fill(false);
        const emitReadyRows = () => {
            if (typeof onLine !== 'function') return;
            rows.forEach((parts, row) => {
                if (emitted[row] || parts.some((part) => isTranslatablePart(part) && !translations.get(part.trim()))) return;
                emitted[row] = true;
                try {
                    onLine(row, rowText(row), { provider: ADDON_ID, final: true });
                } catch (error) {
                    console.warn('[Local AI] Line callback failed:', rawText(error));
                }
            });
        };

        emitReadyRows();
        // Every block is queued at once so the scheduler sees the whole song: the
        // playing song then runs all of its blocks before lower priority work.
        const blocks = buildBlocks(pending);
        const results = blocks.map((block) => runTask(async () => {
            if (job.stopped) throw job.stopReason;
            if (job.failure) throw job.failure;
            try {
                if (Date.now() > deadline) throw timeoutError();
                const instance = await ensureLoaded();
                return await translateBlock(instance, block, language, job.signal,
                    job.kind === 'test' ? (performance) => { job.performance = performance; } : null);
            } catch (error) {
                // Stopping a song nobody waits for aborts its block on purpose; the engine is fine.
                if (job.stopped) throw job.stopReason;
                job.failure ||= error;
                // A crashed WASM runtime or lost GPU device needs a fresh engine next time.
                if (needsFreshEngine(error)) await unloadModel();
                throw error;
            }
        }, job));
        // Failures surface in block order below; the rest are only dropped work.
        results.forEach((result) => result.catch(() => {}));
        try {
            for (const [index, block] of blocks.entries()) {
                const translated = await results[index];
                if (job.stopped) throw job.stopReason;
                block.forEach((part, offset) => translations.set(part, translated[offset]));
                emitReadyRows();
            }
        } catch (error) {
            dropQueuedBlocks(job, error);
            throw error;
        }
        return sourceLines.map((_, row) => rowText(row));
    }

    async function runTestTranslation(onJob) {
        const lang = getCurrentTargetLanguage();
        const language = resolveTargetLanguage(lang);
        const sample = String(lang).toLowerCase().startsWith('ja') ? 'The night is still young.' : '今夜はまだ始まったばかり';
        const started = Date.now();
        const job = startJob({ kind: 'test' });
        onJob?.(job);
        try {
            const [line] = await Promise.race([translateLyricsLines(sample, language, null, job), job.whenStopped]);
            if (job.stopped) throw job.stopReason;
            return { sample, line, seconds: (Date.now() - started) / 1000, performance: job.performance || null };
        } finally {
            finishJob(job);
        }
    }

    // ============================================
    // Settings UI
    // ============================================

    function statusText(snapshot) {
        switch (snapshot.phase) {
            case 'downloading': {
                const total = snapshot.totalBytes || getQualityTier().size;
                return t('statusDownloading', 'Downloading {percent}% · {loaded} / {total} MB', {
                    percent: Math.floor(Math.min(1, snapshot.loadedBytes / total) * 100),
                    loaded: Math.round(snapshot.loadedBytes / 1e6),
                    total: Math.round(total / 1e6)
                });
            }
            case 'downloaded': return t('statusDownloaded', 'Downloaded · Loads into memory when it translates');
            case 'loading': return t('statusLoading', 'Loading into memory…');
            case 'ready': return t('statusReady', 'Ready · {device}', { device: snapshot.device || 'WebGPU' });
            case 'error': return t('statusError', 'Error: {error}', { error: snapshot.error || '' });
            case 'missing': return t('statusNotDownloaded', 'Not downloaded yet. Download the model once to translate on this device.');
            default: return '…';
        }
    }

    const idleLabel = (minutes) => {
        if (!minutes) return t('idleNever', 'Never');
        if (minutes % 60 === 0) return t('idleAfterHours', 'After {hours} hr', { hours: minutes / 60 });
        return t('idleAfter', 'After {minutes} min', { minutes });
    };

    function createSettingsUI() {
        const React = Spicetify.React;
        const { useState, useEffect } = React;
        const h = React.createElement;

        return function LocalModelSettings() {
            const [snapshot, setSnapshot] = useState(() => ({ ...state }));
            const [tierId, setTierId] = useState(() => getQualityTier().id);
            const [device, setDevice] = useState(getDevicePreference);
            const [idleMinutes, setIdleMinutes] = useState(getIdleUnloadMinutes);
            const [confirmRemove, setConfirmRemove] = useState(false);
            const [test, setTest] = useState(null);
            const [testRun] = useState(() => ({ id: 0, job: null }));

            useEffect(() => subscribe(setSnapshot), []);
            useEffect(() => { void refreshStatus(); }, [tierId]);
            useEffect(() => () => {
                testRun.id++;
                testRun.job?.stop(cancelledError());
                testRun.job = null;
            }, []);

            const busy = snapshot.phase === 'downloading' || snapshot.phase === 'loading';
            const hasModel = snapshot.phase === 'downloaded' || snapshot.phase === 'ready';
            // Say so before anyone downloads the model for a language it cannot translate into.
            const targetLanguage = getCurrentTargetLanguage();
            const clearTest = () => {
                testRun.id++;
                testRun.job?.stop(cancelledError());
                testRun.job = null;
                setTest(null);
            };
            useEffect(() => { clearTest(); }, [targetLanguage]);
            const languageSupported = !!targetLanguageName(targetLanguage);
            const tierIndex = Math.max(0, QUALITY_TIERS.findIndex((candidate) => candidate.id === tierId));
            const tier = QUALITY_TIERS[tierIndex];
            const downloadedTiers = Array.isArray(snapshot.downloadedTiers) ? snapshot.downloadedTiers : [];
            const percent = snapshot.phase === 'downloading'
                ? Math.min(100, (snapshot.loadedBytes / (snapshot.totalBytes || tier.size)) * 100)
                : 0;

            const selectTier = (id) => {
                if (busy || id === tierId || !QUALITY_TIERS.some((candidate) => candidate.id === id)) return;
                setSetting('quality', id);
                setTierId(id);
                setConfirmRemove(false);
                clearTest();
                void runTask(unloadModel);
            };
            const changeDevice = async (event) => {
                const next = event.target.value === 'cpu' ? 'cpu' : 'auto';
                setSetting('device', next);
                setDevice(next);
                clearTest();
                await runTask(unloadModel);
            };
            const changeIdle = (event) => {
                const next = Number(event.target.value);
                setSetting('idle-unload-minutes', next);
                setIdleMinutes(next);
                if (!pumping) scheduleIdleUnload();
            };
            const startDownload = () => { clearTest(); void downloadModel().catch(() => {}); };
            const freeMemory = () => { clearTest(); void runTask(unloadModel); };
            const deleteModel = () => {
                if (!confirmRemove) {
                    setConfirmRemove(true);
                    return;
                }
                setConfirmRemove(false);
                clearTest();
                void runTask(removeModel).catch((error) => setState({ phase: 'error', error: friendlyError(error, 'cache').message }));
            };
            const testTranslation = async () => {
                if (testRun.job || busy || !languageSupported) return;
                const id = ++testRun.id;
                setTest({ running: true });
                try {
                    const result = await runTestTranslation((job) => { testRun.job = job; });
                    if (id !== testRun.id) return;
                    setTest({ ok: true, result, tierId, text: `✓ ${result.sample} → ${result.line}` });
                } catch (error) {
                    if (id !== testRun.id) return;
                    setTest({ ok: false, text: `✗ ${friendlyError(error, 'translate').message}` });
                } finally {
                    if (id === testRun.id) testRun.job = null;
                }
            };

            const lastTier = QUALITY_TIERS.length - 1;
            const qualityControl = h('div', { className: 'ai-addon-setting local-model-quality' },
                h('label', null, t('quality', 'Translation quality')),
                h('div', { className: `slider-container${busy ? ' disabled' : ''}` },
                    h('input', {
                        type: 'range', min: 0, max: lastTier, step: 1, value: tierIndex, disabled: busy,
                        className: 'config-slider',
                        'aria-label': t('quality', 'Translation quality'),
                        'aria-valuetext': tierLabel(tier),
                        style: { '--progress-percent': `${(tierIndex / lastTier) * 100}%` },
                        onChange: (event) => selectTier(QUALITY_TIERS[Number(event.target.value)]?.id)
                    })
                ),
                h('div', { className: `local-model-tiers${busy ? ' is-busy' : ''}` }, QUALITY_TIERS.map((candidate) => {
                    const selected = candidate.id === tier.id;
                    return h('div', {
                        key: candidate.id,
                        className: `local-model-tier${selected ? ' is-selected' : ''}`,
                        role: 'button',
                        tabIndex: busy ? -1 : 0,
                        'aria-pressed': selected,
                        'aria-disabled': busy || undefined,
                        'data-tier': candidate.id,
                        onClick: () => selectTier(candidate.id),
                        onKeyDown: (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                selectTier(candidate.id);
                            }
                        }
                    },
                    h('span', { className: 'local-model-tier-name' }, tierLabel(candidate)),
                    h('span', { className: 'local-model-tier-size' },
                        formatGigabytes(candidate.size) + (downloadedTiers.includes(candidate.id) ? ` · ${t('tierDownloaded', 'Downloaded')}` : '')));
                })),
                h('small', { className: 'local-model-hint' },
                    t('tierHint', 'Higher quality translates more accurately but uses more storage and memory.'))
            );

            // Without a supported language the download is not offered, so the line
            // inviting one would only contradict the notice.
            const showStatus = languageSupported || (snapshot.phase !== 'missing' && snapshot.phase !== 'unknown');

            return h('div', { className: 'ai-addon-settings local-model-settings' },
                qualityControl,
                h('div', { className: 'ai-addon-setting' },
                    !languageSupported && h('small', {
                        className: 'ai-addon-test-status error',
                        role: 'note',
                        style: { display: 'block', marginBottom: '8px', lineHeight: 1.5 }
                    }, unsupportedLanguageText(targetLanguage)),
                    showStatus && h('span', {
                        className: `ai-addon-test-status ${snapshot.phase === 'error' ? 'error' : snapshot.phase === 'ready' ? 'success' : ''}`,
                        role: 'status'
                    }, statusText(snapshot)),
                    snapshot.phase === 'downloading' && h('div', {
                        className: 'local-model-progress',
                        role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.floor(percent),
                    }, h('div', { className: 'local-model-progress-bar', style: { width: `${percent}%` } })),
                    h('div', { className: 'ai-addon-input-group', style: { marginTop: '10px', flexWrap: 'wrap' } },
                        snapshot.phase === 'downloading'
                            ? h('button', { type: 'button', className: 'ai-addon-btn ai-addon-btn-secondary', onClick: cancelDownload }, t('cancel', 'Cancel'))
                            : !hasModel && h('button', {
                                type: 'button', className: 'ai-addon-btn ai-addon-btn-primary', onClick: startDownload, disabled: busy || !languageSupported
                            }, t('download', 'Download model ({size})', { size: formatGigabytes(tier.size) })),
                        hasModel && h('button', {
                            type: 'button', className: 'ai-addon-btn ai-addon-btn-primary', onClick: testTranslation, disabled: busy || test?.running || !languageSupported
                        }, test?.running ? '…' : t('test', 'Test translation')),
                        snapshot.phase === 'ready' && h('button', {
                            type: 'button', className: 'ai-addon-btn ai-addon-btn-secondary', onClick: freeMemory
                        }, t('unload', 'Free memory')),
                        hasModel && h('button', {
                            type: 'button', className: 'ai-addon-btn ai-addon-btn-secondary', onClick: deleteModel, disabled: busy
                        }, confirmRemove ? t('confirmRemove', 'Click again to delete') : t('remove', 'Delete model'))
                    ),
                    test && !test.running && h('div', { role: 'status', 'aria-live': 'polite', 'aria-atomic': true,
                        style: { marginTop: '8px', overflowWrap: 'anywhere' } },
                        h('small', { className: `ai-addon-test-status ${test.ok ? 'success' : 'error'}` }, test.text),
                        test.ok && h('small', { style: { display: 'block', marginTop: '4px' } },
                            t('testTotalTime', 'Total: {seconds}s', { seconds: test.result.seconds.toFixed(1) })),
                        test.ok && h('small', { style: { display: 'block', marginTop: '4px' } },
                            test.result.performance
                                ? t('testSpeed', '{speed} output tokens/s · {tokens} tokens · {seconds}s decoding', {
                                    speed: test.result.performance.tokensPerSecond.toFixed(1), tokens: test.result.performance.tokens,
                                    seconds: test.result.performance.seconds.toFixed(2)
                                })
                                : t('testSpeedUnavailable', 'Output speed unavailable for this test.')),
                        test.ok && test.result.performance && h('small', { className: 'local-model-hint', style: { display: 'block', marginTop: '4px' } },
                            t('testSpeedScope', 'Decoding only; excludes download, loading and prompt processing. Speed varies by device, preset and text.')),
                        test.ok && tierIndex > 0 && test.tierId === tierId && h('small', { className: 'local-model-hint', style: { display: 'block', marginTop: '4px' } },
                            t('testSmallerHint', 'If this feels slow, try {tier}, a smaller preset; speed and quality may vary.', {
                                tier: tierLabel(QUALITY_TIERS[tierIndex - 1])
                            })))
                ),
                h('div', { className: 'ai-addon-setting' },
                    h('label', null, t('device', 'Processor')),
                    h('select', { value: device, onChange: changeDevice, disabled: busy },
                        h('option', { value: 'auto' }, t('deviceAuto', 'Auto (WebGPU first)')),
                        h('option', { value: 'cpu' }, t('deviceCpu', 'CPU only (slower)')))
                ),
                h('div', { className: 'ai-addon-setting' },
                    h('label', null, t('idleUnload', 'Free memory when idle')),
                    h('select', { value: String(idleMinutes), onChange: changeIdle },
                        IDLE_UNLOAD_OPTIONS.map((minutes) => h('option', { key: minutes, value: String(minutes) },
                            idleLabel(minutes))))
                ),
                h('small', { className: 'local-model-privacy' },
                    t('privacy', 'Lyrics are translated on this device and are never sent anywhere. The engine (jsDelivr) and the model (Hugging Face) are downloaded only once.'))
            );
        };
    }

    // ============================================
    // Addon
    // ============================================

    const addon = {
        ...ADDON_INFO,

        async init() {
            window.__ivLyricsDebugLog?.(`[Local AI] Initialized (v${ADDON_INFO.version})`);
        },

        getSettingsUI() {
            return createSettingsUI();
        },

        async testConnection() {
            let result;
            try {
                result = await runTestTranslation();
            } catch (error) {
                throw friendlyError(error, 'translate');
            }
            if (!result.line) throw localError('unknown', failureMessage('unknown'));
            return true;
        },

        // The manager passes the song's trackId; only lyrics on screen pass onLine.
        async translateLyrics({ text, lang, wantSmartPhonetic, onLine, trackId }) {
            if (wantSmartPhonetic) {
                throw new Error('[Local AI] Pronunciation generation is not supported');
            }
            if (!text?.trim()) {
                throw new Error('[Local AI] No text provided');
            }
            // An unsupported language fails before it can stop another song's work.
            const language = resolveTargetLanguage(lang);
            const job = startJob({ kind: 'lyrics', trackId, text, onScreen: typeof onLine === 'function' });
            const work = translateLyricsLines(text, language, onLine, job);
            work.catch(() => {});
            try {
                // A newer song ends this request at once, even while its block still runs.
                return { translation: await Promise.race([work, job.whenStopped]) };
            } catch (error) {
                throw friendlyError(error, 'translate');
            } finally {
                finishJob(job);
            }
        }
    };

    const registerAddon = () => {
        if (window.AIAddonManager) {
            window.AIAddonManager.register(addon);
        } else {
            setTimeout(registerAddon, 100);
        }
    };

    registerAddon();
})();
