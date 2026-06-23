<h1 align="center">
  <img src="assets/app_logo.png" width="100" alt="Muslim Atlas Logo" /><br/>
  Muslim Atlas
</h1>

<p align="center">
  <strong>Find mosques, halal food, and prayer times — all in one place.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Android-green?style=flat-square&logo=android" />
  <img src="https://img.shields.io/badge/version-1.0.0-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/built%20with-Expo%20%2F%20React%20Native-blueviolet?style=flat-square&logo=expo" />
  <img src="https://img.shields.io/badge/license-Private-lightgrey?style=flat-square" />
</p>

---

## Overview

Muslim Atlas is a mobile application built for the Muslim community in the UK and beyond. It brings together mosque finding, halal food discovery, and accurate Islamic prayer times into a single, clean, and fast experience.

The app is designed to be genuinely useful day-to-day — whether you need to find the nearest mosque on the go, check when Asr is today, or locate a halal restaurant nearby. It runs without ads and without subscriptions.

---

## Vision

The Muslim community deserves tools built specifically for them, not adapted from generic apps. Muslim Atlas aims to become the go-to companion app for Muslims navigating their daily lives — starting with the UK and expanding globally.

Future ambitions include:

- iOS release
- Community-contributed mosque data and reviews
- Qibla compass and Islamic calendar integration
- Event listings (Jumu'ah times, Ramadan programmes)
- Masjid profiles with live opening hours and facilities info
- Monetisation through non-intrusive, community-relevant advertising

---

## Features

### Mosque Finder
- Interactive Mapbox-powered map showing nearby mosques
- Tap any pin to view mosque details, opening hours, prayer times, and facilities
- List view with distance sorting for quick scanning
- Smart camera clustering that zooms into dense pin groups automatically
- "Search this area" prompt when panning the map manually
- Turn-by-turn navigation to any mosque via integrated Mapbox Navigation

### Halal Food
- Dual-query search for halal restaurants and takeaways near your location
- Distance-prioritised results (closest first)
- Deduplicated results across query types
- Tap pins or list items to view place details and get directions

### Prayer Times
- Accurate Islamic prayer time calculation using the `adhan` library
- Support for multiple calculation methods: London Unified (UK), Muslim World League, Egyptian, Umm Al-Qura, ISNA, Karachi, Turkey, Dubai, Singapore, Tehran, and Moonsighting Committee
- High latitude adjustment rules: Auto, Twilight Angle, Seventh of the Night, Middle of the Night
- Timezone-aware calculations using each location's local timezone
- Hanafi/Standard Asr method toggle
- Prayer times shown on the home screen, mosque detail sheets, and the Android home screen widget

### Android Home Screen Widget
- Displays all 5 daily prayer times plus Sunrise at a glance
- Shows current prayer, next prayer, location name, Gregorian and Hijri date
- Premium gradient background (sky blue to slate dark)
- Updates automatically every 30 minutes

### User Accounts
- Optional Firebase authentication (email/password and Google Sign-In)
- Saves preferences and settings per account

### Settings
- Light and dark theme support
- Calculation method and high latitude rule selection
- Hanafi Asr toggle
- Support link to Buy Me a Coffee

---

## Screenshots

> Coming soon.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native (Expo SDK 54) |
| Maps | Mapbox Maps SDK (`@rnmapbox/maps`) |
| Navigation | Mapbox Navigation (`@youssefhenna/expo-mapbox-navigation`) |
| Prayer Times | Adhan JS (`adhan`) |
| Backend / Auth | Firebase (Firestore + Auth) |
| Places Search | Google Places API (New) |
| Widget | `react-native-android-widget` |
| State Management | React Context API |
| Storage | AsyncStorage |
| Animations | Reanimated + Gesture Handler |

---

## Installation

### Prerequisites

- Node.js 18+
- Android Studio with Android SDK (API 24+)
- Java 17
- Expo CLI (`npm install -g expo-cli`)

### Environment Variables

Create a `.env` file in the project root with the following keys:

```env
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=
RNMAPBOX_MAPS_DOWNLOAD_TOKEN=
EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=
```

### Running in Development

```bash
npm install
npx expo run:android
```

### Building a Release APK

```bash
npx expo prebuild --platform android --no-install
cd android
./gradlew assembleRelease
```

The signed APK will be output to:
```
android/app/build/outputs/apk/release/app-release.apk
```

---

## Download

Pre-built release APKs are available on the [Releases](https://github.com/YusufQuresh1/Muslim-Atlas/releases) page.

> Google Play Store listing coming soon.

---

## Support

If Muslim Atlas has been useful to you, you can support its development at:

**[buymeacoffee.com/muslimatlas](https://buymeacoffee.com/muslimatlas)**

Every contribution helps cover API and server costs. JazakAllah khayran.

---

## License

This project is private. All rights reserved. Not licensed for redistribution or commercial use.
