// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Fix: @rnmapbox/maps web module tries to import mapbox-gl/dist/mapbox-gl.css
// which doesn't exist in a React Native (non-web) project.
// We mock CSS files to empty modules so the bundler doesn't choke on them.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Redirect CSS imports to a no-op empty module
  if (moduleName.endsWith('.css')) {
    return {
      filePath: path.resolve(__dirname, 'emptyModule.js'),
      type: 'sourceFile',
    };
  }
  // Fall back to default resolution for everything else
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
