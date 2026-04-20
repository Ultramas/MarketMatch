const ebayProxyBaseUrlNode = document.getElementById('ebayProxyBaseUrl');
const proxyAccessKeyNode = document.getElementById('proxyAccessKey');
const ebayMarketplaceIdNode = document.getElementById('ebayMarketplaceId');
const endUserZipNode = document.getElementById('endUserZip');
const ebayLimitNode = document.getElementById('ebayLimit');
const minPositiveRatingsNode = document.getElementById('minPositiveRatings');
const maxNegativeRatioDivisorNode = document.getElementById('maxNegativeRatioDivisor');
const defaultTaxRateNode = document.getElementById('defaultTaxRate');
const defaultStateNode = document.getElementById('defaultState');
const statusNode = document.getElementById('status');
const normalizeProxyBaseUrl = globalThis.MarketMatchLib?.normalizeProxyBaseUrl;
const normalizeProxyAccessKey = globalThis.MarketMatchLib?.normalizeProxyAccessKey;
const isLoopbackProxyBaseUrl = globalThis.MarketMatchLib?.isLoopbackProxyBaseUrl;
const maskProxyAccessKey = globalThis.MarketMatchLib?.maskProxyAccessKey;
const fetchProxyHealth = globalThis.MarketMatchLib?.fetchProxyHealth;
const sanitizeSettings = globalThis.MarketMatchLib?.sanitizeSettings;

const DEFAULT_SETTINGS = {
  ebayProxyBaseUrl: '',
  proxyAccessKey: '',
  ebayMarketplaceId: 'EBAY_US',
  endUserZip: '',
  ebayLimit: 10,
  minPositiveRatings: 5,
  maxNegativeRatioDivisor: 5,
  defaultTaxRate: 0,
  defaultState: '',
  ...(globalThis.MarketMatchLib?.DEFAULT_SETTINGS || {}),
};

document.getElementById('save').addEventListener('click', save);
restore();

async function save() {
  const rawTaxRate = Number(defaultTaxRateNode.value || 0);
  const normalizedTaxRate = rawTaxRate > 1 ? rawTaxRate / 100 : rawTaxRate;
  const rawProxyBaseUrl = String(ebayProxyBaseUrlNode.value || '').trim();
  const normalizedProxyBaseUrl = typeof normalizeProxyBaseUrl === 'function'
    ? normalizeProxyBaseUrl(rawProxyBaseUrl)
    : rawProxyBaseUrl.replace(/\/+$/, '');
  const proxyAccessKey = typeof normalizeProxyAccessKey === 'function'
    ? normalizeProxyAccessKey(proxyAccessKeyNode.value)
    : String(proxyAccessKeyNode.value || '').trim();

  if (rawProxyBaseUrl && !normalizedProxyBaseUrl) {
    statusNode.textContent = JSON.stringify({
      ok: false,
      error: 'Enter a valid http:// or https:// backend URL.',
    }, null, 2);
    return;
  }

  if (normalizedProxyBaseUrl && !isLocalProxyUrl(normalizedProxyBaseUrl) && !proxyAccessKey) {
    statusNode.textContent = JSON.stringify({
      ok: false,
      error: 'Set a proxy access key before saving a non-local backend URL.',
    }, null, 2);
    return;
  }

  if (normalizedProxyBaseUrl && !isLocalProxyUrl(normalizedProxyBaseUrl) && !normalizedProxyBaseUrl.startsWith('https://')) {
    statusNode.textContent = JSON.stringify({
      ok: false,
      error: 'Use an https:// backend URL for non-local proxy access.',
    }, null, 2);
    return;
  }

  if (normalizedProxyBaseUrl) {
    const permissionGranted = await ensureProxyPermission(normalizedProxyBaseUrl);
    if (!permissionGranted) {
      statusNode.textContent = JSON.stringify({
        ok: false,
        error: 'Firefox must grant host access to the backend origin before the extension can reach your proxy.',
      }, null, 2);
      return;
    }
  }

  const settings = typeof sanitizeSettings === 'function'
    ? sanitizeSettings({
      ebayProxyBaseUrl: normalizedProxyBaseUrl,
      proxyAccessKey,
      ebayMarketplaceId: ebayMarketplaceIdNode.value,
      endUserZip: endUserZipNode.value,
      ebayLimit: ebayLimitNode.value,
      minPositiveRatings: minPositiveRatingsNode.value,
      maxNegativeRatioDivisor: maxNegativeRatioDivisorNode.value,
      defaultTaxRate: normalizedTaxRate,
      defaultState: defaultStateNode.value,
    })
    : {
      ebayProxyBaseUrl: normalizedProxyBaseUrl,
      proxyAccessKey,
      ebayMarketplaceId: String(ebayMarketplaceIdNode.value || DEFAULT_SETTINGS.ebayMarketplaceId).trim() || DEFAULT_SETTINGS.ebayMarketplaceId,
      endUserZip: String(endUserZipNode.value || '').trim(),
      ebayLimit: Math.min(20, Math.max(1, Number(ebayLimitNode.value || DEFAULT_SETTINGS.ebayLimit))),
      minPositiveRatings: Math.max(0, Number(minPositiveRatingsNode.value || DEFAULT_SETTINGS.minPositiveRatings)),
      maxNegativeRatioDivisor: Math.max(1, Number(maxNegativeRatioDivisorNode.value || DEFAULT_SETTINGS.maxNegativeRatioDivisor)),
      defaultTaxRate: Math.max(0, Math.min(normalizedTaxRate, 1)),
      defaultState: String(defaultStateNode.value || '').trim(),
    };

  await chrome.storage.local.set({ settings });
  await renderSavedSettingsStatus(settings);
}

async function restore() {
  const { settings } = await chrome.storage.local.get('settings');
  const mergedSettings = typeof sanitizeSettings === 'function'
    ? sanitizeSettings(settings || {})
    : { ...DEFAULT_SETTINGS, ...(settings || {}) };

  if (settings?.ebayApplicationToken) {
    await chrome.storage.local.set({ settings: mergedSettings });
  }

  ebayProxyBaseUrlNode.value = mergedSettings.ebayProxyBaseUrl ?? '';
  proxyAccessKeyNode.value = mergedSettings.proxyAccessKey ?? '';
  ebayMarketplaceIdNode.value = mergedSettings.ebayMarketplaceId ?? DEFAULT_SETTINGS.ebayMarketplaceId;
  endUserZipNode.value = mergedSettings.endUserZip ?? '';
  ebayLimitNode.value = mergedSettings.ebayLimit ?? DEFAULT_SETTINGS.ebayLimit;
  minPositiveRatingsNode.value = mergedSettings.minPositiveRatings ?? DEFAULT_SETTINGS.minPositiveRatings;
  maxNegativeRatioDivisorNode.value = mergedSettings.maxNegativeRatioDivisor ?? DEFAULT_SETTINGS.maxNegativeRatioDivisor;
  defaultTaxRateNode.value = mergedSettings.defaultTaxRate ?? DEFAULT_SETTINGS.defaultTaxRate;
  defaultStateNode.value = mergedSettings.defaultState ?? DEFAULT_SETTINGS.defaultState;
  await renderSavedSettingsStatus(mergedSettings);
}

async function renderSavedSettingsStatus(settings = {}) {
  const proxyHealth = typeof fetchProxyHealth === 'function'
    ? await fetchProxyHealth(settings)
    : { state: settings.ebayProxyBaseUrl ? 'unknown' : 'missing' };
  statusNode.textContent = JSON.stringify({
    ebayProxyBaseUrl: settings.ebayProxyBaseUrl || '[empty]',
    proxyAccessKey: typeof maskProxyAccessKey === 'function'
      ? maskProxyAccessKey(settings.proxyAccessKey)
      : (settings.proxyAccessKey ? '[stored]' : '[empty]'),
    proxyAccessKeyConfigured: Boolean(settings.proxyAccessKey),
    ebayMarketplaceId: settings.ebayMarketplaceId || DEFAULT_SETTINGS.ebayMarketplaceId,
    endUserZip: settings.endUserZip || '',
    ebayLimit: settings.ebayLimit ?? DEFAULT_SETTINGS.ebayLimit,
    minPositiveRatings: settings.minPositiveRatings ?? DEFAULT_SETTINGS.minPositiveRatings,
    maxNegativeRatioDivisor: settings.maxNegativeRatioDivisor ?? DEFAULT_SETTINGS.maxNegativeRatioDivisor,
    defaultTaxRate: settings.defaultTaxRate ?? DEFAULT_SETTINGS.defaultTaxRate,
    defaultState: settings.defaultState ?? DEFAULT_SETTINGS.defaultState,
    proxyHealth,
  }, null, 2);
}

async function ensureProxyPermission(baseUrl) {
  const permissionsApi = chrome.permissions;
  if (!permissionsApi?.request || !permissionsApi?.contains) {
    return true;
  }

  const originPattern = buildProxyOriginPattern(baseUrl);
  if (!originPattern) {
    return false;
  }

  const alreadyGranted = await permissionsApi.contains({ origins: [originPattern] });
  if (alreadyGranted) {
    return true;
  }

  return permissionsApi.request({ origins: [originPattern] });
}

function buildProxyOriginPattern(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    return `${parsed.protocol}//${parsed.hostname}/*`;
  } catch {
    return '';
  }
}

function isLocalProxyUrl(baseUrl) {
  if (typeof isLoopbackProxyBaseUrl === 'function') {
    return isLoopbackProxyBaseUrl(baseUrl);
  }

  try {
    const parsed = new URL(baseUrl);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(parsed.hostname || '').trim().toLowerCase());
  } catch {
    return false;
  }
}
