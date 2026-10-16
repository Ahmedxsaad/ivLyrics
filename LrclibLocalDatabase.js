/**
 * Local LRCLIB coordinator. The runtime extension supplies the bundled worker
 * source; this service never downloads code, opens a server, or reads a whole DB.
 * Only references/metadata live in this private IndexedDB, never settings/cloud.
 */
(() => {
    'use strict';

    const root = typeof window === 'undefined' ? globalThis : window;
    if (root.IvLyricsLocalLrclib) return;

    const DB_NAME = 'ivLyricsLocalLrclib';
    const STORE = 'references';
    const RECORD_KEY = 'active';
    const PENDING_KEY = 'pending';
    const DIRECTORY = 'ivlyrics-lrclib-local';
    const OWN_FILE = /^ivlyrics-lrclib-[a-f0-9]{32}\.sqlite3$/;
    const QUERY_TIMEOUT = 3000;
    const OPEN_TIMEOUT = 15000;
    const QUOTA_INTERVAL = 16 * 1024 * 1024;
    const WRITE_CHUNK = 1024 * 1024;
    const CODES = new Set([
        'unsupported', 'invalidFile', 'invalidDatabase', 'noSpace',
        'canceled', 'permission', 'unavailable'
    ]);
    const emptyState = () => ({
        phase: 'empty', name: '', size: 0, progress: 0,
        bytesWritten: 0, errorCode: null, revision: ''
    });
    let state = emptyState();
    let active = null;
    let databasePromise = null;
    let queue = null;
    let controls = 0;
    let connecting = null;
    let restoreController = null;
    let nextRequest = 0;
    const subscribers = new Set();
    const imports = new Set();

    const error = code => Object.assign(new Error(code), { code });
    function normalizeError(value, fallback = 'unavailable') {
        if (CODES.has(value?.code)) return error(value.code);
        if (value?.name === 'AbortError') return error('canceled');
        if (value?.name === 'QuotaExceededError') return error('noSpace');
        if (value?.name === 'NotAllowedError' || value?.name === 'SecurityError') return error('permission');
        if (value?.name === 'NotSupportedError') return error('unsupported');
        return error(fallback);
    }
    function publish(update) {
        state = { ...state, ...update };
        for (const fn of [...subscribers]) {
            try { fn({ ...state }); } catch (_) { /* Observers cannot break an import. */ }
        }
    }
    function report(value) {
        const failure = normalizeError(value);
        publish({ phase: failure.code === 'permission' ? 'permission' : 'error', errorCode: failure.code });
        return failure;
    }
    function checkAbort(signal) {
        if (signal?.aborted) throw error('canceled');
    }
    function enqueue(task) {
        const result = (queue || Promise.resolve()).then(task);
        const settled = result.then(() => undefined, () => undefined);
        queue = settled;
        settled.then(() => { if (queue === settled) queue = null; });
        return result;
    }
    function control(task, signal, waiting) {
        controls++;
        return enqueue(() => {
            checkAbort(signal);
            waiting?.();
            const locks = root.navigator?.locks;
            if (typeof locks?.request !== 'function') return task(false);
            return locks.request(DB_NAME, { mode: 'exclusive', ...(signal ? { signal } : {}) }, () => {
                checkAbort(signal);
                return task(true);
            });
        }).finally(() => { controls--; });
    }
    function uniqueId() {
        if (typeof root.crypto?.randomUUID === 'function') return root.crypto.randomUUID().replace(/-/g, '');
        if (!root.crypto?.getRandomValues) throw error('unsupported');
        return Array.from(root.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    }

    // All persistence is lazy, and transaction completion (not request success)
    // is the commit point for replacing the previous database reference.
    function getDatabase() {
        if (!root.indexedDB) return Promise.reject(error('unsupported'));
        if (databasePromise) return databasePromise;
        databasePromise = new Promise((resolve, reject) => {
            let finished = false;
            const request = root.indexedDB.open(DB_NAME, 1);
            const timer = root.setTimeout(() => fail(error('unavailable')), 5000);
            function fail(reason) {
                if (finished) return;
                finished = true;
                root.clearTimeout(timer);
                databasePromise = null;
                reject(normalizeError(reason));
            }
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
            };
            request.onerror = () => fail(request.error);
            request.onblocked = () => fail(error('unavailable'));
            request.onsuccess = () => {
                const db = request.result;
                if (finished) { db.close(); return; }
                finished = true;
                root.clearTimeout(timer);
                db.onversionchange = () => { db.close(); databasePromise = null; };
                resolve(db);
            };
        });
        // Also allow retries after a synchronous indexedDB.open exception.
        databasePromise = databasePromise.catch(reason => { databasePromise = null; throw normalizeError(reason); });
        return databasePromise;
    }
    async function metadata(mode, record, signal) {
        checkAbort(signal);
        if (!root.indexedDB) {
            if (mode === 'snapshot') return { record: null, pending: [] };
            if (mode === 'read' || record === null || record?.kind === 'file') return null;
            throw error('unsupported');
        }
        const db = await getDatabase();
        checkAbort(signal);
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, mode === 'read' || mode === 'snapshot' ? 'readonly' : 'readwrite');
            const store = tx.objectStore(STORE);
            let result = null;
            let request;
            const abort = () => { try { tx.abort(); } catch (_) { /* Already committed. */ } };
            const cleanup = () => signal?.removeEventListener('abort', abort);
            tx.oncomplete = () => { cleanup(); resolve(result); };
            tx.onabort = tx.onerror = () => {
                cleanup();
                reject(signal?.aborted ? error('canceled') : normalizeError(tx.error || request?.error));
            };
            signal?.addEventListener('abort', abort, { once: true });
            const fail = reason => {
                abort();
                cleanup();
                reject(normalizeError(reason));
            };
            try {
                request = store.get(RECORD_KEY);
                request.onsuccess = () => {
                    const previous = request.result ?? null;
                    if (mode === 'read') { result = previous; return; }
                    try {
                        request = store.get(PENDING_KEY);
                        request.onsuccess = () => {
                            try {
                                const pending = new Map((Array.isArray(request.result) ? request.result : [])
                                    .filter(item => isOwned(item) && ['importing', 'cleanup'].includes(item.status))
                                    .map(item => [item.opfsName, item]));
                                if (mode === 'snapshot') {
                                    result = { record: previous, pending: [...pending.values()] };
                                    return;
                                }
                                if (mode === 'refresh') {
                                    // A restore without Web Locks must not resurrect a source
                                    // replaced by another context while its worker was opening.
                                    result = previous?.revision === record.previous.revision;
                                    if (result) store.put(record.next, RECORD_KEY);
                                    return;
                                }
                                if (mode === 'write') {
                                    result = previous;
                                    if (record === null) store.delete(RECORD_KEY);
                                    else store.put(record, RECORD_KEY);
                                    if (isOwned(record)) pending.delete(record.opfsName);
                                    if (isOwned(previous) && previous.opfsName !== record?.opfsName) {
                                        pending.set(previous.opfsName, { kind: 'opfs', opfsName: previous.opfsName, status: 'cleanup' });
                                    }
                                } else if (isOwned(record)) {
                                    if (mode === 'forget') pending.delete(record.opfsName);
                                    else if (previous?.kind !== 'opfs' || previous.opfsName !== record.opfsName) {
                                        pending.set(record.opfsName, { kind: 'opfs', opfsName: record.opfsName,
                                            status: mode === 'stage' ? 'importing' : 'cleanup' });
                                    }
                                }
                                if (pending.size) store.put([...pending.values()], PENDING_KEY);
                                else store.delete(PENDING_KEY);
                            } catch (reason) { fail(reason); }
                        };
                    } catch (reason) { fail(reason); }
                };
            } catch (reason) { fail(reason); }
        });
    }
    function isOwned(record) {
        return record?.kind === 'opfs' && typeof record.opfsName === 'string' && OWN_FILE.test(record.opfsName);
    }
    function validRecord(record) {
        return record && typeof record.name === 'string' && Number.isSafeInteger(record.size) && record.size > 0
            && typeof record.revision === 'string' && /^[a-f0-9]{32}$/.test(record.revision)
            && (record.kind === 'file' || record.kind === 'handle' && record.handle?.kind === 'file'
                || record.kind === 'opfs' && OWN_FILE.test(record.opfsName));
    }
    async function getDirectory(create = false) {
        const storage = root.navigator?.storage;
        if (!storage?.getDirectory) throw error('unsupported');
        const directory = await storage.getDirectory();
        return directory.getDirectoryHandle(DIRECTORY, { create });
    }
    async function removeOwned(record, directory) {
        if (!isOwned(record)) return false;
        try {
            const ownDirectory = directory || await getDirectory();
            await ownDirectory.removeEntry(record.opfsName);
            return true;
        } catch (reason) {
            // Keep the journal entry on transient failures so restart can retry.
            return reason?.name === 'NotFoundError';
        }
    }
    async function cleanupPending(exclusive, signal) {
        const snapshot = await metadata('snapshot', undefined, signal);
        for (const record of snapshot.pending) {
            checkAbort(signal);
            if (snapshot.record?.kind === 'opfs' && snapshot.record.opfsName === record.opfsName) continue;
            // Only an exclusive cross-context lock proves an unfinished import
            // is abandoned. Without it, another tab may still be writing.
            if (record.status === 'importing' && !exclusive) continue;
            if (await removeOwned(record)) await metadata('forget', record, signal);
        }
    }
    async function discardTemporary(temporary) {
        if (!isOwned(temporary.record)) return;
        try {
            await metadata('retire', temporary.record);
            if (await removeOwned(temporary.record, temporary.directory)) await metadata('forget', temporary.record);
        } catch (_) { /* The durable import entry is retried under the next exclusive lock. */ }
    }

    function checkWorkerSupport() {
        if (typeof root.Worker !== 'function' || typeof root.Blob !== 'function'
            || !root.URL?.createObjectURL || !root.URL?.revokeObjectURL) throw error('unsupported');
        if (typeof root.IvLyricsLocalLrclibWorkerSource !== 'string'
            || !root.IvLyricsLocalLrclibWorkerSource.trim()) throw error('unavailable');
    }
    function revoke(session) {
        if (session.url) { root.URL.revokeObjectURL(session.url); session.url = null; }
    }
    function dispose(session, reason = error('unavailable')) {
        if (!session || session.closed) return;
        session.closed = true;
        session.worker.terminate();
        revoke(session);
        for (const pending of [...session.pending.values()]) pending.reject(reason);
        session.pending.clear();
    }
    function createSession() {
        checkWorkerSupport();
        const url = root.URL.createObjectURL(new root.Blob([root.IvLyricsLocalLrclibWorkerSource], { type: 'text/javascript' }));
        let worker;
        try { worker = new root.Worker(url); }
        catch (reason) { root.URL.revokeObjectURL(url); throw normalizeError(reason); }
        const session = { worker, url, closed: false, pending: new Map() };
        worker.onmessage = event => {
            revoke(session);
            const message = event.data;
            const pending = session.pending.get(message?.id);
            if (!pending) return;
            if (message.error) pending.reject(normalizeError(message.error));
            else pending.resolve(message.result);
        };
        worker.onerror = event => { event.preventDefault?.(); dispose(session); };
        worker.onmessageerror = () => dispose(session);
        return session;
    }
    function request(session, action, payload, { signal, timeout = OPEN_TIMEOUT } = {}) {
        checkAbort(signal);
        if (session.closed) return Promise.reject(error('unavailable'));
        return new Promise((resolve, reject) => {
            const id = ++nextRequest;
            const cleanup = () => {
                root.clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                session.pending.delete(id);
            };
            const abort = () => dispose(session, error('canceled'));
            const timer = root.setTimeout(() => dispose(session), Math.max(1, timeout));
            session.pending.set(id, {
                resolve(value) { cleanup(); resolve(value); },
                reject(reason) { cleanup(); reject(reason); }
            });
            signal?.addEventListener('abort', abort, { once: true });
            try { session.worker.postMessage({ id, action, ...payload }); }
            catch (reason) { dispose(session, normalizeError(reason)); }
        });
    }
    async function fileType(file) {
        if (!file || !Number.isSafeInteger(file.size) || file.size < 2
            || typeof file.slice !== 'function' || typeof file.name !== 'string') throw error('invalidFile');
        let bytes;
        try { bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer()); }
        catch (reason) { throw normalizeError(reason, 'invalidFile'); }
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) return 'gzip';
        const signature = 'SQLite format 3\0';
        if (bytes.length === signature.length && [...signature].every((char, i) => bytes[i] === char.charCodeAt(0))) return 'sqlite';
        throw error('invalidFile');
    }

    async function decompress(file, signal, temporary) {
        if (typeof root.DecompressionStream !== 'function' || typeof root.TransformStream !== 'function'
            || typeof file.stream !== 'function') throw error('unsupported');
        const directory = await getDirectory(true);
        checkAbort(signal);
        let consumed = 0;
        let written = 0;
        let sampledAt = -QUOTA_INTERVAL;
        let remaining = Infinity;
        let lastProgress = 0;
        const sqliteHeader = new Uint8Array(16);
        let headerLength = 0;
        async function ensureSpace(length) {
            if (written - sampledAt >= QUOTA_INTERVAL || remaining - (written - sampledAt) < length) {
                const estimate = await root.navigator.storage.estimate?.();
                checkAbort(signal);
                sampledAt = written;
                remaining = Number.isFinite(estimate?.quota) && Number.isFinite(estimate?.usage)
                    ? Math.max(0, estimate.quota - estimate.usage) : Infinity;
            }
            if (remaining - (written - sampledAt) < length) throw error('noSpace');
        }
        await ensureSpace(1);
        temporary.record = { kind: 'opfs', opfsName: `ivlyrics-lrclib-${uniqueId()}.sqlite3` };
        temporary.directory = directory;
        // Commit recovery metadata before a file (or a large closed output) can
        // survive a reload. Successful activation removes this entry atomically.
        await metadata('stage', temporary.record, signal);
        checkAbort(signal);
        const handle = await directory.getFileHandle(temporary.record.opfsName, { create: true });
        checkAbort(signal);
        let writer;
        let reader;
        const abort = () => { if (reader) void reader.cancel().catch(() => {}); };
        signal.addEventListener('abort', abort, { once: true });
        try {
            writer = await handle.createWritable();
            checkAbort(signal);
            reader = file.stream().pipeThrough(new root.TransformStream({
                transform(chunk, controller) { consumed += chunk.byteLength; controller.enqueue(chunk); }
            })).pipeThrough(new root.DecompressionStream('gzip')).getReader();
            while (true) {
                checkAbort(signal);
                const { value, done } = await reader.read();
                checkAbort(signal);
                if (done) break;
                if (headerLength < sqliteHeader.length) {
                    const length = Math.min(sqliteHeader.length - headerLength, value.byteLength);
                    sqliteHeader.set(value.subarray(0, length), headerLength);
                    headerLength += length;
                    if (headerLength === sqliteHeader.length && ![...'SQLite format 3\0']
                        .every((char, index) => sqliteHeader[index] === char.charCodeAt(0))) throw error('invalidFile');
                }
                for (let offset = 0; offset < value.byteLength; offset += WRITE_CHUNK) {
                    const chunk = value.subarray(offset, offset + WRITE_CHUNK);
                    await ensureSpace(chunk.byteLength);
                    checkAbort(signal);
                    await writer.write(chunk);
                    written += chunk.byteLength;
                    checkAbort(signal);
                }
                const now = Date.now();
                if (now - lastProgress >= 100) {
                    lastProgress = now;
                    publish({ bytesWritten: written, progress: Math.min(0.99, consumed / file.size) });
                }
            }
            await writer.close();
            writer = null;
            checkAbort(signal);
            publish({ bytesWritten: written, progress: 0.99 });
            return await handle.getFile();
        } catch (reason) {
            if (writer) { try { await writer.abort(); } catch (_) { /* Cleanup continues below. */ } }
            throw signal.aborted ? error('canceled') : normalizeError(reason, 'invalidFile');
        } finally {
            signal.removeEventListener('abort', abort);
            if (reader) {
                try { await reader.cancel(); } catch (_) { /* Already errored/closed. */ }
                reader.releaseLock();
            }
        }
    }

    function ready(record) {
        publish({ phase: 'ready', name: record.name, size: record.size, progress: 1,
            bytesWritten: record.kind === 'opfs' ? record.size : 0, errorCode: null, revision: record.revision });
    }
    function importFile(file, { handle, signal } = {}) {
        const controller = new root.AbortController();
        const abort = () => controller.abort();
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
        imports.add(controller);
        return control(async exclusive => {
            const temporary = {};
            let candidate = null;
            let committed = false;
            try {
                checkAbort(controller.signal);
                checkWorkerSupport();
                publish({ phase: 'opening', name: file?.name || '', size: file?.size || 0,
                    progress: 0, bytesWritten: 0, errorCode: null });
                const type = await fileType(file);
                checkAbort(controller.signal);
                await cleanupPending(exclusive, controller.signal);
                checkAbort(controller.signal);
                let databaseFile = file;
                if (type === 'gzip') {
                    publish({ phase: 'importing' });
                    databaseFile = await decompress(file, controller.signal, temporary);
                    if (await fileType(databaseFile) !== 'sqlite') throw error('invalidFile');
                }
                checkAbort(controller.signal);
                candidate = createSession();
                publish({ phase: 'opening' });
                await request(candidate, 'open', { file: databaseFile }, { signal: controller.signal });
                checkAbort(controller.signal);
                const record = {
                    kind: type === 'gzip' ? 'opfs' : handle ? 'handle' : 'file',
                    name: file.name, size: databaseFile.size, revision: uniqueId(),
                    lastModified: databaseFile.lastModified,
                    ...(type === 'gzip' ? { opfsName: temporary.record.opfsName } : handle ? { handle } : {})
                };
                // Read the actual persisted predecessor and journal its cleanup
                // in the same transaction that activates the new source.
                await metadata('write', record, controller.signal);
                // Cancellation after the IDB commit must not delete the new DB.
                committed = true;
                const old = active;
                active = { record, file: databaseFile, session: candidate };
                candidate = null;
                dispose(old?.session);
                ready(record);
                await cleanupPending(exclusive).catch(() => {});
                return { ...state };
            } finally {
                dispose(candidate);
                if (!committed) await discardTemporary(temporary);
            }
        }, controller.signal, () => publish({ phase: 'opening', name: file?.name || '', size: file?.size || 0,
            progress: 0, bytesWritten: 0, errorCode: null }))
            .catch(reason => { throw report(reason); })
            .finally(() => {
                imports.delete(controller);
                signal?.removeEventListener('abort', abort);
            });
    }
    function connect() {
        if (connecting) return connecting;
        const controller = new root.AbortController();
        restoreController = controller;
        connecting = control(async exclusive => {
            let candidate = null;
            try {
                checkAbort(controller.signal);
                await cleanupPending(exclusive, controller.signal);
                const record = root.indexedDB ? await metadata('read', undefined, controller.signal) : active?.record;
                checkAbort(controller.signal);
                if (!record) {
                    dispose(active?.session);
                    active = null;
                    publish(emptyState());
                    return { ...state };
                }
                if (!validRecord(record)) throw error('invalidDatabase');
                const sameSource = active?.record.revision === record.revision;
                if (sameSource && !active.session?.closed) { ready(active.record); return { ...state }; }
                publish({ phase: 'opening', name: record.name, size: record.size,
                    progress: 0, bytesWritten: 0, errorCode: null, revision: record.revision });
                let file = sameSource ? active.file : null;
                if (!file && record.kind === 'handle') {
                    // Restore must never request permission without a user gesture.
                    if (!record.handle.queryPermission || await record.handle.queryPermission({ mode: 'read' }) !== 'granted') {
                        throw error('permission');
                    }
                    file = await record.handle.getFile();
                } else if (!file && record.kind === 'opfs') {
                    const directory = await getDirectory();
                    file = await (await directory.getFileHandle(record.opfsName)).getFile();
                } else if (!file) {
                    throw error('permission'); // An input-selected File must be reselected after a restart.
                }
                checkAbort(controller.signal);
                if (await fileType(file) !== 'sqlite') throw error('invalidFile');
                checkAbort(controller.signal);
                candidate = createSession();
                await request(candidate, 'open', { file }, { signal: controller.signal });
                checkAbort(controller.signal);
                // A changed original invalidates caches; no full-file hashing/read.
                const changed = file.size !== record.size || record.kind === 'handle' && file.lastModified !== record.lastModified;
                const restored = changed ? { ...record, size: file.size, lastModified: file.lastModified, revision: uniqueId() } : record;
                if (restored !== record && !await metadata('refresh', { previous: record, next: restored }, controller.signal)) {
                    throw error('unavailable');
                }
                if (!exclusive && root.indexedDB) {
                    const current = await metadata('read', undefined, controller.signal);
                    if (current?.revision !== restored.revision) throw error('unavailable');
                }
                dispose(active?.session);
                active = { record: restored, file, session: candidate };
                candidate = null;
                ready(restored);
                return { ...state };
            } catch (reason) {
                report(reason);
                return { ...state };
            } finally { dispose(candidate); }
        }, controller.signal).catch(reason => {
            report(reason);
            return { ...state };
        }).finally(() => {
            connecting = null;
            if (restoreController === controller) restoreController = null;
        });
        return connecting;
    }
    function cancelImport() {
        for (const controller of imports) controller.abort();
        restoreController?.abort();
    }
    function remove() {
        cancelImport();
        return control(async exclusive => {
            try {
                await metadata('write', null);
                dispose(active?.session);
                active = null;
                publish(emptyState());
                await cleanupPending(exclusive).catch(() => {});
                return { ...state };
            } catch (reason) { throw report(reason); }
        });
    }
    function lookup(info) {
        if (controls || !active) return Promise.resolve(null);
        const expected = active;
        const started = Date.now();
        const controller = new root.AbortController();
        return new Promise(resolve => {
            let finished = false;
            const finish = result => {
                if (finished) return;
                finished = true;
                root.clearTimeout(timer);
                resolve(result);
            };
            // Includes queueing and reopening time, not just worker execution.
            const timer = root.setTimeout(() => { controller.abort(); finish(null); }, QUERY_TIMEOUT);
            enqueue(async () => {
                if (finished || controls || active !== expected) return null;
                try {
                    const remaining = () => Math.max(1, QUERY_TIMEOUT - (Date.now() - started));
                    if (expected.session?.closed) {
                        expected.session = createSession();
                        await request(expected.session, 'open', { file: expected.file }, { signal: controller.signal, timeout: remaining() });
                    }
                    checkAbort(controller.signal);
                    return await request(expected.session, 'lookup', { info }, { signal: controller.signal, timeout: remaining() });
                } catch (reason) {
                    if (active === expected) report(controller.signal.aborted ? error('unavailable') : normalizeError(reason));
                    return null;
                }
            }).then(result => finish(result ?? null), () => finish(null));
        });
    }
    async function pickFile() {
        try {
            if (typeof root.showOpenFilePicker === 'function') {
                // Call immediately, retaining the caller's user activation.
                const [handle] = await root.showOpenFilePicker({
                    multiple: false,
                    types: [{ description: 'LRCLIB SQLite', accept: { 'application/octet-stream': ['.sqlite3', '.gz'] } }]
                });
                if (!handle) throw error('canceled');
                return await importFile(await handle.getFile(), { handle });
            }
            if (!root.document?.createElement) throw error('unsupported');
            const file = await new Promise((resolve, reject) => {
                const input = root.document.createElement('input');
                input.type = 'file';
                input.accept = '.sqlite3,.sqlite3.gz,.gz';
                input.style.display = 'none';
                const cleanup = () => {
                    input.removeEventListener('change', change);
                    input.removeEventListener('cancel', cancel);
                    input.remove();
                };
                const change = () => {
                    const selected = input.files?.[0];
                    cleanup();
                    if (selected) resolve(selected); else reject(error('canceled'));
                };
                const cancel = () => { cleanup(); reject(error('canceled')); };
                input.addEventListener('change', change);
                input.addEventListener('cancel', cancel);
                root.document.body?.appendChild(input);
                try { input.click(); } catch (reason) { cleanup(); reject(reason); }
            });
            return await importFile(file);
        } catch (reason) { throw report(reason); }
    }

    root.IvLyricsLocalLrclib = Object.freeze({
        getState: () => ({ ...state }),
        subscribe(fn) {
            if (typeof fn !== 'function') return () => {};
            subscribers.add(fn);
            try { fn({ ...state }); } catch (_) { /* Same isolation as publish(). */ }
            return () => subscribers.delete(fn);
        },
        connect, pickFile, importFile, cancelImport,
        disconnect: remove, remove, lookup,
        getCacheVersion: () => state.revision
    });
})();
