(function bootstrapMarketplaceAdapters(globalScope) {
  const registry = {};

  globalScope.MarketMatchAdapters = {
    registerAdapter(platform, factory) {
      registry[platform] = factory;
    },
    getAdapter(platform) {
      return typeof registry[platform] === 'function' ? registry[platform]() : null;
    },
    listPlatforms() {
      return Object.keys(registry);
    },
  };
})(globalThis);
