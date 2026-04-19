const ebayApplicationTokenNode = document.getElementById('ebayApplicationToken');
const ebayMarketplaceIdNode = document.getElementById('ebayMarketplaceId');
const endUserZipNode = document.getElementById('endUserZip');
const ebayLimitNode = document.getElementById('ebayLimit');
const minPositiveRatingsNode = document.getElementById('minPositiveRatings');
const maxNegativeRatioDivisorNode = document.getElementById('maxNegativeRatioDivisor');
const defaultTaxRateNode = document.getElementById('defaultTaxRate');
const defaultStateNode = document.getElementById('defaultState');
const statusNode = document.getElementById('status');

document.getElementById('save').addEventListener('click', save);
restore();

async function save() {
  const settings = {
    ebayApplicationToken: String(ebayApplicationTokenNode.value || '').trim(),
    ebayMarketplaceId: String(ebayMarketplaceIdNode.value || 'EBAY_US').trim() || 'EBAY_US',
    endUserZip: String(endUserZipNode.value || '').trim(),
    ebayLimit: Number(ebayLimitNode.value || 10),
    minPositiveRatings: Number(minPositiveRatingsNode.value || 5),
    maxNegativeRatioDivisor: Number(maxNegativeRatioDivisorNode.value || 5),
    defaultTaxRate: Number(defaultTaxRateNode.value || 0),
    defaultState: String(defaultStateNode.value || '').trim(),
  };

  await chrome.storage.local.set({ settings });
  statusNode.textContent = JSON.stringify({
    ...settings,
    ebayApplicationToken: settings.ebayApplicationToken ? '[saved]' : '[empty]',
  }, null, 2);
}

async function restore() {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) return;

  ebayApplicationTokenNode.value = settings.ebayApplicationToken ?? '';
  ebayMarketplaceIdNode.value = settings.ebayMarketplaceId ?? 'EBAY_US';
  endUserZipNode.value = settings.endUserZip ?? '';
  ebayLimitNode.value = settings.ebayLimit ?? 10;
  minPositiveRatingsNode.value = settings.minPositiveRatings ?? 5;
  maxNegativeRatioDivisorNode.value = settings.maxNegativeRatioDivisor ?? 5;
  defaultTaxRateNode.value = settings.defaultTaxRate ?? 0;
  defaultStateNode.value = settings.defaultState ?? '';
}
