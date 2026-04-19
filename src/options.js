const ebayApplicationTokenNode = document.getElementById('ebayApplicationToken');
const ebayMarketplaceIdNode = document.getElementById('ebayMarketplaceId');
const endUserZipNode = document.getElementById('endUserZip');
const ebayLimitNode = document.getElementById('ebayLimit');
const minPositiveRatingsNode = document.getElementById('minPositiveRatings');
const maxNegativeRatioDivisorNode = document.getElementById('maxNegativeRatioDivisor');
const defaultTaxRateNode = document.getElementById('defaultTaxRate');
const defaultStateNode = document.getElementById('defaultState');
const statusNode = document.getElementById('status');

const DEFAULT_SETTINGS = {
  ebayApplicationToken: '',
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

  const settings = {
    ebayApplicationToken: String(ebayApplicationTokenNode.value || '').trim(),
    ebayMarketplaceId: String(ebayMarketplaceIdNode.value || DEFAULT_SETTINGS.ebayMarketplaceId).trim() || DEFAULT_SETTINGS.ebayMarketplaceId,
    endUserZip: String(endUserZipNode.value || '').trim(),
    ebayLimit: Math.min(20, Math.max(1, Number(ebayLimitNode.value || DEFAULT_SETTINGS.ebayLimit))),
    minPositiveRatings: Math.max(0, Number(minPositiveRatingsNode.value || DEFAULT_SETTINGS.minPositiveRatings)),
    maxNegativeRatioDivisor: Math.max(1, Number(maxNegativeRatioDivisorNode.value || DEFAULT_SETTINGS.maxNegativeRatioDivisor)),
    defaultTaxRate: Math.max(0, Math.min(normalizedTaxRate, 1)),
    defaultState: String(defaultStateNode.value || '').trim(),
  };

  await chrome.storage.local.set({ settings });
  renderSavedSettingsStatus(settings);
}

async function restore() {
  const { settings } = await chrome.storage.local.get('settings');
  const mergedSettings = { ...DEFAULT_SETTINGS, ...(settings || {}) };

  ebayApplicationTokenNode.value = mergedSettings.ebayApplicationToken ?? '';
  ebayMarketplaceIdNode.value = mergedSettings.ebayMarketplaceId ?? DEFAULT_SETTINGS.ebayMarketplaceId;
  endUserZipNode.value = mergedSettings.endUserZip ?? '';
  ebayLimitNode.value = mergedSettings.ebayLimit ?? DEFAULT_SETTINGS.ebayLimit;
  minPositiveRatingsNode.value = mergedSettings.minPositiveRatings ?? DEFAULT_SETTINGS.minPositiveRatings;
  maxNegativeRatioDivisorNode.value = mergedSettings.maxNegativeRatioDivisor ?? DEFAULT_SETTINGS.maxNegativeRatioDivisor;
  defaultTaxRateNode.value = mergedSettings.defaultTaxRate ?? DEFAULT_SETTINGS.defaultTaxRate;
  defaultStateNode.value = mergedSettings.defaultState ?? DEFAULT_SETTINGS.defaultState;
  renderSavedSettingsStatus(mergedSettings);
}

function renderSavedSettingsStatus(settings = {}) {
  statusNode.textContent = JSON.stringify({
    ...settings,
    ebayApplicationToken: settings.ebayApplicationToken ? '[saved]' : '[empty]',
  }, null, 2);
}
