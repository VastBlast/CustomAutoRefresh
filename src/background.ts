import {
  DEFAULT_INTERVAL_SECONDS,
  formatBadgeText,
  normalizeIntervalSeconds
} from './lib/refresh/interval';
import { DEFAULT_OPTIONS, sanitizeOptions, type RefreshOptions } from './lib/refresh/options';
import type { RefreshRequest, RefreshResponse, RefreshState } from './lib/refresh/types';
import {
  ICON_ARROW,
  ICON_BACKGROUND,
  ICON_STROKE_WIDTH,
  ICON_VIEWBOX,
  REFRESH_ARC_PATHS,
  REFRESH_HEAD_PATHS,
  type IconState
} from './lib/icon';

interface StoredRefreshJob {
  tabId: number;
  intervalMs: number;
  nextRefreshAt: number;
  startedAt: number;
  refreshCount: number;
  options: RefreshOptions;
}

interface RefreshJob extends StoredRefreshJob {
  refreshing: boolean;
}

interface StoredState {
  jobs: StoredRefreshJob[];
  lastIntervalMs?: number | null;
  // Legacy per-tab defaults from releases before lastIntervalMs.
  lastIntervals?: Record<string, number>;
  lastOptions: RefreshOptions;
}

interface ActionState {
  badgeText: string;
  icon: IconState;
}

const ACTION_ICON_SIZES = [16, 24, 32] as const;
const STORAGE_KEY = 'customAutoRefresh';
const KEEP_ALIVE_PORT = 'custom-auto-refresh:keepAlive';
const REFRESH_SETTLE_TIMEOUT_MS = 60000;
const REFRESH_SETTLE_POLL_MS = 250;
const REFRESH_COMPLETE_GRACE_MS = 750;
const BADGE_TICK_MS = 250;

// Jobs are held in memory for fast ticking and mirrored to storage so MV3
// service-worker restarts can resume active refreshes.
const jobs = new Map<number, RefreshJob>();

// Browser action updates are relatively expensive. This cache prevents repeated
// badge/icon writes, but it must be invalidated on navigation because Chrome can
// reset per-tab action icons while a page reloads.
const actionStates = new Map<number, ActionState>();
const iconImageData = new Map<IconState, Record<number, ImageData>>();
let lastIntervalMs: number | null = null;
let legacyLastIntervals: Record<string, number> = {};
let lastOptions: RefreshOptions = DEFAULT_OPTIONS;
let scheduler: ReturnType<typeof setTimeout> | undefined;
let initialized: Promise<void> | undefined;

runQuietly(initialize());

chrome.runtime.onMessage.addListener((message: RefreshRequest, _sender, sendResponse) => {
  void handleMessage(message)
    .then((data) => sendResponse({ ok: true, data } satisfies RefreshResponse<RefreshState>))
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Refresh command failed.';
      sendResponse({ ok: false, error: message } satisfies RefreshResponse<RefreshState>);
    });
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== KEEP_ALIVE_PORT) {
    return;
  }

  // MV3 service workers can suspend between timers. A long-lived port from a
  // normal web page keeps this worker available for accurate badge updates and
  // scheduled reloads; reconnect before Chrome's five-minute port limit.
  const tabId = port.sender?.tab?.id;
  const timer = setTimeout(() => port.disconnect(), 250000);
  port.onDisconnect.addListener(() => {
    clearTimeout(timer);
    if (jobs.size > 0) {
      runQuietly(connectKeepAlive(tabId));
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!jobs.has(tabId)) {
    return;
  }
  runQuietly(forgetTab(tabId));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!jobs.has(tabId)) {
    return;
  }

  // Navigation can clear the toolbar icon even though our in-memory job stays
  // active, so force the next update to rewrite the action state.
  if (changeInfo.status === 'loading' || changeInfo.status === 'complete') {
    actionStates.delete(tabId);
  }
  if (changeInfo.status === 'loading' || changeInfo.status === 'complete' || tab.status === 'complete') {
    runQuietly(updateAction(tabId));
  }
  if (changeInfo.status === 'complete') {
    runQuietly(connectKeepAlive(tabId));
  }
});

async function initialize(): Promise<void> {
  initialized ??= (async () => {
    const stored = await readStoredState();
    lastIntervalMs = stored.lastIntervalMs ?? null;
    legacyLastIntervals = stored.lastIntervals ?? {};
    lastOptions = stored.lastOptions;
    jobs.clear();
    for (const job of stored.jobs) {
      if (job.tabId > 0 && job.intervalMs >= 0) {
        jobs.set(job.tabId, { ...job, refreshing: false });
      }
    }
    await Promise.all(Array.from(jobs.keys(), (tabId) => updateAction(tabId)));
    scheduleTick();
    if (jobs.size > 0) {
      await connectKeepAlive();
    }
  })();
  return initialized;
}

async function handleMessage(message: RefreshRequest): Promise<RefreshState> {
  await initialize();
  if (message.type === 'popup:get-state') {
    return getActiveTabState();
  }
  if (message.type === 'refresh:start') {
    return startActiveTab(message.intervalSeconds, message.options);
  }
  if (message.type === 'refresh:stop') {
    return stopActiveTab();
  }
  throw new Error('Unknown refresh command.');
}

async function startActiveTab(intervalSeconds: number, rawOptions: unknown): Promise<RefreshState> {
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error('This page cannot be refreshed by the extension.');
  }

  const options = sanitizeOptions(rawOptions);
  const intervalMs = normalizeIntervalSeconds(intervalSeconds) * 1000;
  const now = Date.now();
  jobs.set(tab.id, {
    tabId: tab.id,
    intervalMs,
    nextRefreshAt: options.refreshImmediately ? now : now + intervalMs,
    startedAt: now,
    refreshCount: 0,
    options,
    refreshing: false
  });
  lastIntervalMs = intervalMs;
  legacyLastIntervals = {};
  lastOptions = options;
  await saveState();
  await updateAction(tab.id);
  rescheduleTick();
  runQuietly(connectKeepAlive(tab.id));
  return getStateForTab(tab);
}

async function stopActiveTab(): Promise<RefreshState> {
  const tab = await getActiveTab();
  if (tab?.id) {
    await stopTab(tab.id);
  }
  return getStateForTab(tab);
}

async function stopTab(tabId: number): Promise<void> {
  await forgetTab(tabId);
  await setInactiveAction(tabId);
}

async function forgetTab(tabId: number): Promise<void> {
  const job = jobs.get(tabId);
  if (job) {
    if (lastIntervalMs === null) {
      legacyLastIntervals[String(tabId)] = job.intervalMs;
    }
    jobs.delete(tabId);
  }
  actionStates.delete(tabId);
  await saveState();
  rescheduleTick();
}

async function runTick(): Promise<void> {
  scheduler = undefined;
  await initialize();
  const now = Date.now();

  for (const job of jobs.values()) {
    if (job.refreshing) {
      continue;
    }
    if (reachedLimit(job, now)) {
      runQuietly(stopTab(job.tabId));
    } else if (job.nextRefreshAt <= now) {
      runQuietly(refreshTab(job));
    } else {
      await updateAction(job.tabId);
    }
  }

  scheduleTick();
}

// Count- and time-based stop conditions from the job's advanced options.
function reachedLimit(job: RefreshJob, now: number): boolean {
  const { maxRefreshes, stopAfterMinutes } = job.options;
  if (maxRefreshes !== null && job.refreshCount >= maxRefreshes) {
    return true;
  }
  return stopAfterMinutes !== null && now - job.startedAt >= stopAfterMinutes * 60000;
}

async function refreshTab(job: RefreshJob): Promise<void> {
  job.refreshing = true;
  try {
    await updateAction(job.tabId);
    const tab = await getTab(job.tabId);
    if (!tab) {
      await stopTab(job.tabId);
      return;
    }

    await reloadAndWaitForTabSettled(job.tabId, job.options.bypassCache);
    const current = jobs.get(job.tabId);
    if (current) {
      current.refreshCount += 1;
      const completedAt = Date.now();
      if (reachedLimit(current, completedAt)) {
        await stopTab(current.tabId);
        return;
      }
      current.nextRefreshAt = completedAt + current.intervalMs;
      await saveState();
    }
  } catch {
    await stopTab(job.tabId);
  } finally {
    const current = jobs.get(job.tabId);
    if (current) {
      current.refreshing = false;
      await updateAction(job.tabId);
      rescheduleTick();
    }
  }
}

function scheduleTick(): void {
  if (scheduler || jobs.size === 0) {
    return;
  }

  // Wake at the next due job, capped below one second so normal timer drift
  // does not skip a visible badge countdown value.
  const now = Date.now();
  let nextDelay = BADGE_TICK_MS;
  for (const job of jobs.values()) {
    if (job.refreshing) {
      continue;
    }
    nextDelay = Math.min(nextDelay, job.nextRefreshAt - now);
  }
  nextDelay = Math.max(0, Math.min(BADGE_TICK_MS, nextDelay));
  scheduler = setTimeout(() => runQuietly(runTick()), nextDelay);
}

function rescheduleTick(): void {
  if (scheduler) {
    clearTimeout(scheduler);
    scheduler = undefined;
  }
  scheduleTick();
}

async function getActiveTabState(): Promise<RefreshState> {
  const tab = await getActiveTab();
  return getStateForTab(tab);
}

function getStateForTab(tab: chrome.tabs.Tab | undefined): RefreshState {
  const tabId = tab?.id;
  const job = tabId === undefined ? undefined : jobs.get(tabId);
  const savedIntervalMs = lastIntervalMs ?? (tabId === undefined ? undefined : legacyLastIntervals[String(tabId)]);
  const intervalMs = job?.intervalMs ?? savedIntervalMs ?? DEFAULT_INTERVAL_SECONDS * 1000;

  return {
    canRefresh: Boolean(tabId),
    isRefreshing: Boolean(job),
    intervalSeconds: intervalMs / 1000,
    remainingMs: job ? Math.max(0, job.nextRefreshAt - Date.now()) : null,
    nextRefreshAt: job?.nextRefreshAt ?? null,
    options: job?.options ?? lastOptions,
    refreshCount: job?.refreshCount ?? 0
  };
}

async function updateAction(tabId: number): Promise<void> {
  const job = jobs.get(tabId);
  if (!job) {
    await setInactiveAction(tabId);
    return;
  }

  const remainingMs = Math.max(0, job.nextRefreshAt - Date.now());
  const updated = await setActionState(
    tabId,
    'active',
    job.refreshing ? '...' : formatBadgeText(remainingMs, job.intervalMs)
  );
  if (!updated) {
    await forgetTab(tabId);
  }
}

async function setInactiveAction(tabId: number): Promise<boolean> {
  return setActionState(tabId, 'inactive', '');
}

async function setActionState(tabId: number, icon: IconState, badgeText: string): Promise<boolean> {
  try {
    const current = actionStates.get(tabId);
    if (current?.badgeText !== badgeText) {
      await chromeCall<void>((resolve) => chrome.action.setBadgeText({ tabId, text: badgeText }, resolve));
    }
    if (icon === 'active' && current?.icon !== 'active') {
      await chromeCall<void>((resolve) =>
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#1a7f4b' }, resolve)
      );
    }
    if (current?.icon !== icon) {
      await chromeCall<void>((resolve) =>
        chrome.action.setIcon(
          {
            tabId,
            imageData: getActionIconData(icon)
          },
          resolve
        )
      );
    }
    actionStates.set(tabId, { badgeText, icon });
    return true;
  } catch (error) {
    if (isMissingTabError(error)) {
      actionStates.delete(tabId);
      return false;
    }
    throw error;
  }
}

function getActionIconData(icon: IconState): Record<number, ImageData> {
  let cached = iconImageData.get(icon);
  if (!cached) {
    cached = {};
    for (const size of ACTION_ICON_SIZES) {
      cached[size] = createActionIconImageData(icon, size);
    }
    iconImageData.set(icon, cached);
  }
  return cached;
}

function createActionIconImageData(icon: IconState, size: number): ImageData {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not create action icon.');
  }

  context.scale(size / ICON_VIEWBOX, size / ICON_VIEWBOX);
  context.fillStyle = ICON_BACKGROUND[icon];
  context.beginPath();
  context.arc(16, 16, 16, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = ICON_ARROW;
  context.fillStyle = ICON_ARROW;
  context.lineWidth = ICON_STROKE_WIDTH;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const path of REFRESH_ARC_PATHS) {
    context.stroke(new Path2D(path));
  }
  for (const path of REFRESH_HEAD_PATHS) {
    context.fill(new Path2D(path));
  }

  return context.getImageData(0, 0, size, size);
}

async function connectKeepAlive(tabId?: number): Promise<void> {
  const tabIds = tabId === undefined ? Array.from(jobs.keys()) : jobs.has(tabId) ? [tabId] : [];
  const jobTabs = await Promise.all(tabIds.map((id) => getTab(id)));
  if (await connectToFirstAvailableTab(jobTabs)) {
    return;
  }

  // Some refresh targets reject script injection. A fallback HTTP(S) tab can
  // still hold the keep-alive port; refresh jobs themselves remain tab-scoped.
  const fallbackTabs = await queryInjectableTabs();
  await connectToFirstAvailableTab(fallbackTabs);
}

async function connectToFirstAvailableTab(tabs: Array<chrome.tabs.Tab | undefined>): Promise<boolean> {
  for (const tab of tabs) {
    if (tab?.id === undefined) {
      continue;
    }
    if (await injectKeepAlive(tab.id)) {
      return true;
    }
  }
  return false;
}

async function injectKeepAlive(tabId: number): Promise<boolean> {
  try {
    await chromeCall<chrome.scripting.InjectionResult<void>[]>((resolve) =>
      chrome.scripting.executeScript(
        {
          target: { tabId },
          func: connectPort,
          args: [KEEP_ALIVE_PORT]
        },
        resolve
      )
    );
    return true;
  } catch {
    return false;
  }
}

function connectPort(portName: string): void {
  chrome.runtime.connect({ name: portName });
}

function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return chromeCall((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0])));
}

function getTab(tabId: number): Promise<chrome.tabs.Tab | undefined> {
  return chromeCall<chrome.tabs.Tab>((resolve) => chrome.tabs.get(tabId, resolve)).catch(() => undefined);
}

function queryInjectableTabs(): Promise<chrome.tabs.Tab[]> {
  return chromeCall((resolve) => chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, resolve));
}

function reloadTab(tabId: number, bypassCache: boolean): Promise<void> {
  return chromeCall((resolve) => chrome.tabs.reload(tabId, { bypassCache }, resolve));
}

async function reloadAndWaitForTabSettled(tabId: number, bypassCache: boolean): Promise<void> {
  let armed = false;
  let armedAt = 0;
  let sawLoading = false;
  let settled = false;
  let resolveSettled = (): void => undefined;

  const settledPromise = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  const timeout = setTimeout(done, REFRESH_SETTLE_TIMEOUT_MS);
  const poll = setInterval(() => runQuietly(checkTabStatus()), REFRESH_SETTLE_POLL_MS);

  function listener(updatedTabId: number, changeInfo: { status?: string }): void {
    if (updatedTabId !== tabId) {
      return;
    }
    if (changeInfo.status === 'loading') {
      sawLoading = true;
    }
    if (armed && changeInfo.status === 'complete') {
      done();
    }
  }

  async function checkTabStatus(): Promise<void> {
    if (!armed || settled) {
      return;
    }

    const tab = await getTab(tabId);
    if (!tab || !jobs.has(tabId)) {
      done();
      return;
    }
    if (tab.status === 'loading') {
      sawLoading = true;
      return;
    }
    if (tab.status === 'complete' && (sawLoading || Date.now() - armedAt >= REFRESH_COMPLETE_GRACE_MS)) {
      done();
    }
  }

  function done(): void {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeout);
    clearInterval(poll);
    chrome.tabs.onUpdated.removeListener(listener);
    resolveSettled();
  }

  chrome.tabs.onUpdated.addListener(listener);
  try {
    await reloadTab(tabId, bypassCache);
    armed = true;
    armedAt = Date.now();
    runQuietly(checkTabStatus());
    await settledPromise;
  } catch (error) {
    done();
    throw error;
  }
}

async function readStoredState(): Promise<StoredState> {
  const value = await chromeCall<Record<string, StoredState | undefined>>((resolve) =>
    chrome.storage.local.get(STORAGE_KEY, resolve)
  );
  return sanitizeStoredState(value[STORAGE_KEY]);
}

async function saveState(): Promise<void> {
  const stored: StoredState = {
    jobs: Array.from(jobs.values(), ({ tabId, intervalMs, nextRefreshAt, startedAt, refreshCount, options }) => ({
      tabId,
      intervalMs,
      nextRefreshAt,
      startedAt,
      refreshCount,
      options
    })),
    lastIntervalMs,
    lastIntervals: legacyLastIntervals,
    lastOptions
  };
  await chromeCall<void>((resolve) => chrome.storage.local.set({ [STORAGE_KEY]: stored }, resolve));
}

function sanitizeStoredState(value: StoredState | undefined): StoredState {
  if (!value || typeof value !== 'object') {
    return { jobs: [], lastIntervalMs: null, lastIntervals: {}, lastOptions: DEFAULT_OPTIONS };
  }

  const lastIntervals: Record<string, number> = {};
  if (value.lastIntervals && typeof value.lastIntervals === 'object' && !Array.isArray(value.lastIntervals)) {
    for (const [tabId, storedInterval] of Object.entries(value.lastIntervals)) {
      const intervalMs = normalizeStoredIntervalMs(storedInterval);
      if (intervalMs !== undefined) {
        lastIntervals[tabId] = intervalMs;
      }
    }
  }

  // Extension storage is user/modifiable state, so validate it before trusting
  // persisted jobs after a service-worker restart or extension update. Older
  // jobs may predate the advanced options, so missing fields fall back safely.
  return {
    jobs: Array.isArray(value.jobs)
      ? value.jobs
          .filter(
            (job) =>
              Number.isInteger(job.tabId) &&
              Number.isFinite(job.intervalMs) &&
              job.intervalMs >= 0 &&
              Number.isFinite(job.nextRefreshAt)
          )
          .map((job) => ({
            tabId: job.tabId,
            intervalMs: job.intervalMs,
            nextRefreshAt: job.nextRefreshAt,
            startedAt: Number.isFinite(job.startedAt) ? job.startedAt : Date.now(),
            refreshCount: Number.isInteger(job.refreshCount) && job.refreshCount >= 0 ? job.refreshCount : 0,
            options: sanitizeOptions(job.options)
          }))
      : [],
    lastIntervalMs: normalizeStoredIntervalMs(value.lastIntervalMs) ?? null,
    lastIntervals,
    lastOptions: sanitizeOptions(value.lastOptions)
  };
}

function normalizeStoredIntervalMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return normalizeIntervalSeconds(value / 1000) * 1000;
}

function chromeCall<T>(action: (resolve: (value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    action((value) => {
      const message = chrome.runtime.lastError?.message;
      if (message) {
        reject(new Error(message));
      } else {
        resolve(value);
      }
    });
  });
}

function runQuietly(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

function isMissingTabError(error: unknown): boolean {
  return error instanceof Error && /^(No tab with id: \d+\.|Invalid tab ID: \d+\.?)$/i.test(error.message);
}
