import 'dotenv/config';

export default {
  expo: {
    name: 'Muslim Atlas',
    slug: 'muslim-atlas',
    version: '1.0.0',
    extra: {
      eas: {
        projectId: '20433b8b-bf61-4ff8-8c7d-e63727a570b5',
      },
    },
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    ios: {
      supportsTablet: true,
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      edgeToEdgeEnabled: true,
      package: 'com.anonymous.MosqueMap',
      config: {
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY,
        },
      },
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      [
        '@rnmapbox/maps',
        {
          RNMapboxMapsVersion: '11.11.0',
        },
      ],
      [
        '@youssefhenna/expo-mapbox-navigation',
        {
          accessToken:
            process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN,
          mapboxMapsVersion: '11.11.0',
        },
      ],
      [
        'expo-build-properties',
        {
          ios: {
            useFrameworks: 'static',
          },
        },
      ],
      [
        'react-native-android-widget',
        {
          widgets: [
            {
              name: 'PrayerWidget',
              label: 'Muslim Atlas Prayer Times',
              minWidth: '250dp',
              minHeight: '110dp',
              targetCellWidth: 4,
              targetCellHeight: 2,
              updatePeriodMillis: 1800000,
              description: "Today's prayer times for Muslim Atlas",
            },
          ],
        },
      ],
    ],
  },
};
