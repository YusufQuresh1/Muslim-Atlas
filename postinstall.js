/**
 * postinstall.js
 *
 * Patches native Mapbox libraries to fix compilation errors with Mapbox SDK v11.
 *
 * 1. @youssefhenna/expo-mapbox-navigation – LifecycleOwner null-safe cast
 * 2. @youssefhenna/expo-mapbox-navigation – Remove deprecated .voiceUnits() calls
 * 3. @rnmapbox/maps – Comment out deprecated style properties removed in SDK v11.11
 */

const fs = require('fs');
const path = require('path');

// ─── Helper ────────────────────────────────────────────────────────────────────
function patchFile(filePath, patches, label) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[postinstall] Skipping ${label}: file not found at`, filePath);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  for (const { find, replace, check } of patches) {
    if (check && content.includes(check)) {
      console.log(`[postinstall] ${label}: patch already applied (found "${check}"), skipping.`);
      continue;
    }
    if (content.includes(find)) {
      content = content.replace(find, replace);
      changed = true;
      console.log(`[postinstall] ${label}: applied patch.`);
    } else {
      console.warn(`[postinstall] ${label}: target code not found, library may have changed.`);
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[postinstall] ${label}: file saved.`);
  }
}

// ─── 1. Patch ExpoMapboxNavigationView.kt ──────────────────────────────────────
const navViewFile = path.join(
  __dirname,
  'node_modules',
  '@youssefhenna',
  'expo-mapbox-navigation',
  'android', 'src', 'main', 'java', 'expo', 'modules', 'mapboxnavigation',
  'ExpoMapboxNavigationView.kt'
);

patchFile(navViewFile, [
  // 1a. LifecycleOwner null-safe cast
  {
    find: `    init {
        this.setViewTreeLifecycleOwner(
                appContext.activityProvider?.currentActivity as LifecycleOwner
        )
    }`,
    replace: `    init {
        // Safe null-check: under New Architecture (Fabric), currentActivity can be null
        // during view construction. Force-casting null as LifecycleOwner throws
        // NullPointerException -> InvocationTargetException. Use a safe cast instead.
        val lifecycleOwner = appContext.activityProvider?.currentActivity as? LifecycleOwner
        if (lifecycleOwner != null) {
            this.setViewTreeLifecycleOwner(lifecycleOwner)
        }
    }`,
    check: 'as? LifecycleOwner',
  },
  // 1b. Remove .voiceUnits() – removed from Navigation SDK v3.11+
  {
    find: '.voiceUnits(com.mapbox.api.directions.v5.DirectionsCriteria.IMPERIAL)',
    replace: '// .voiceUnits(com.mapbox.api.directions.v5.DirectionsCriteria.IMPERIAL)',
    check: '// .voiceUnits(',
  },
], 'expo-mapbox-navigation');

// ─── 2. Patch ExpoMapboxNavigationModule.kt ─────────────────────────────────────
const navModuleFile = path.join(
  __dirname,
  'node_modules',
  '@youssefhenna',
  'expo-mapbox-navigation',
  'android', 'src', 'main', 'java', 'expo', 'modules', 'mapboxnavigation',
  'ExpoMapboxNavigationModule.kt'
);

patchFile(navModuleFile, [
  {
    find: `      (activity as LifecycleOwner).lifecycleScope.launch(Dispatchers.Main) {
        if (!MapboxNavigationApp.isSetup()) {
          MapboxNavigationApp.setup {
            NavigationOptions.Builder(activity.applicationContext).build()
          }
        }
        MapboxNavigationApp.attach(activity as LifecycleOwner)`,
    replace: `      val currentAct = appContext.activityProvider?.currentActivity ?: return@OnActivityEntersForeground
      (currentAct as LifecycleOwner).lifecycleScope.launch(Dispatchers.Main) {
        if (!MapboxNavigationApp.isSetup()) {
          MapboxNavigationApp.setup {
            NavigationOptions.Builder(currentAct.applicationContext).build()
          }
        }
        MapboxNavigationApp.attach(currentAct as LifecycleOwner)`,
    check: 'val currentAct = appContext.activityProvider',
  },
], 'expo-mapbox-navigation-module');

// ─── 3. Patch RNMBXStyleFactory.kt (@rnmapbox/maps) ────────────────────────────
const styleFactoryFile = path.join(
  __dirname,
  'node_modules',
  '@rnmapbox',
  'maps',
  'android', 'src', 'main', 'java', 'com', 'rnmapbox', 'rnmbx',
  'components', 'styles',
  'RNMBXStyleFactory.kt'
);

// These properties were removed in Mapbox Maps SDK v11.11 but are still
// referenced by @rnmapbox/maps v10.2.10. We comment out the body of each
// setter so the function signature remains (callers still reference it in the
// when-block) but the unresolved SDK call is removed.
const deprecatedSetters = [
  { name: 'fillPatternCrossFade',          layer: 'FillLayer',          layerProp: 'fillPatternCrossFade',          logTag: 'RNMBXFill',          valueType: 'Double' },
  { name: 'linePatternCrossFade',          layer: 'LineLayer',          layerProp: 'linePatternCrossFade',          logTag: 'RNMBXLine',          valueType: 'Double' },
  { name: 'fillExtrusionPatternCrossFade', layer: 'FillExtrusionLayer', layerProp: 'fillExtrusionPatternCrossFade', logTag: 'RNMBXFillExtrusion', valueType: 'Double' },
];

// circleElevationReference uses enum instead of Double
const circleElevRefFind = `    fun setCircleElevationReference(layer: CircleLayer, styleValue: RNMBXStyleValue ) {
      if (styleValue.isExpression()) {
        val expression = styleValue.getExpression()
        if (expression != null) {
          layer.circleElevationReference(expression)
        } else {
          Logger.e("RNMBXCircle", "Expression for circleElevationReference is null")
        }
      } else {
          layer.circleElevationReference(CircleElevationReference.valueOf(styleValue.getEnumName()))
      }
    }`;
const circleElevRefReplace = `    fun setCircleElevationReference(layer: CircleLayer, styleValue: RNMBXStyleValue ) {
      /*
      if (styleValue.isExpression()) {
        val expression = styleValue.getExpression()
        if (expression != null) {
          layer.circleElevationReference(expression)
        } else {
          Logger.e("RNMBXCircle", "Expression for circleElevationReference is null")
        }
      } else {
          layer.circleElevationReference(CircleElevationReference.valueOf(styleValue.getEnumName()))
      }
      */
    }`;

const stylePatches = deprecatedSetters.map(({ name, layer, layerProp, logTag, valueType }) => {
  const getter = valueType === 'Double' ? 'getDouble' : 'getInt';
  const find = `    fun set${name.charAt(0).toUpperCase() + name.slice(1)}(layer: ${layer}, styleValue: RNMBXStyleValue ) {
      if (styleValue.isExpression()) {
        val expression = styleValue.getExpression()
        if (expression != null) {
          layer.${layerProp}(expression)
        } else {
          Logger.e("${logTag}", "Expression for ${layerProp} is null")
        }
      } else {
          val value = styleValue.${getter}(VALUE_KEY)
          if (value != null) {
            layer.${layerProp}(value)
          } else {
            Logger.e("${logTag}", "value for ${layerProp} is null")
          }
      }
    }`;
  const replace = find
    .replace(`      if (styleValue`, `      /*\n      if (styleValue`)
    .replace(`      }\n    }`, `      */\n    }`);
  return { find, replace, check: null };
});

stylePatches.push({
  find: circleElevRefFind,
  replace: circleElevRefReplace,
  check: null,
});

patchFile(styleFactoryFile, stylePatches, 'rnmapbox-maps-style-factory');
