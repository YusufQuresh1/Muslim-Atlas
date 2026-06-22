import React from 'react';
import { requestWidgetUpdate } from 'react-native-android-widget';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { calculatePrayerTimes } from './src/utils/prayerEngine';
import { PrayerWidget } from './src/widgets/PrayerWidget';

const ASR_METHOD_KEY = '@muslimatlas_asr_method';
const PRAYER_OFFSETS_KEY = '@muslimatlas_prayer_offsets';
const CALCULATION_METHOD_KEY = '@muslimatlas_calc_method';
const HIGH_LATITUDE_RULE_KEY = '@muslimatlas_high_lat_rule';

export async function widgetTaskHandler(props) {
  const { widgetAction } = props;

  if (widgetAction === 'WIDGET_ADDED' || widgetAction === 'WIDGET_UPDATE' || widgetAction === 'WIDGET_RESIZED') {
    // 1. Load preferences and location from AsyncStorage
    let lat = 51.5074; // London fallback
    let lng = -0.1278;
    let asrMethod = 'standard';
    let prayerOffsets = { Fajr: 0, Sunrise: 0, Dhuhr: 0, Asr: 0, Maghrib: 0, Isha: 0 };
    let calculationMethod = 'MuslimWorldLeague';
    let highLatitudeRule = 'Auto';

    let locationName = 'Muslim Atlas';

    try {
      const cachedLoc = await AsyncStorage.getItem('@cached_location');
      if (cachedLoc) {
        const parsedLoc = JSON.parse(cachedLoc);
        if (parsedLoc?.latitude && parsedLoc?.longitude) {
          lat = parsedLoc.latitude;
          lng = parsedLoc.longitude;
        }
      }

      const storedLocName = await AsyncStorage.getItem('@cached_location_name');
      if (storedLocName) {
        locationName = storedLocName;
      }

      const storedAsr = await AsyncStorage.getItem(ASR_METHOD_KEY);
      if (storedAsr) {
        asrMethod = storedAsr;
      }

      const storedOffsets = await AsyncStorage.getItem(PRAYER_OFFSETS_KEY);
      if (storedOffsets) {
        prayerOffsets = JSON.parse(storedOffsets);
      }

      const storedCalc = await AsyncStorage.getItem(CALCULATION_METHOD_KEY);
      if (storedCalc) {
        calculationMethod = storedCalc;
      }

      const storedHighLat = await AsyncStorage.getItem(HIGH_LATITUDE_RULE_KEY);
      if (storedHighLat) {
        highLatitudeRule = storedHighLat;
      }
    } catch (e) {
      console.warn('Widget task handler failed to load config:', e);
    }

    // 2. Calculate prayer times
    const now = new Date();
    const times = calculatePrayerTimes(lat, lng, now, {
      asrMethod,
      prayerOffsets,
      calculationMethod,
      highLatitudeRule,
    });

    // 3. Find next upcoming prayer
    const currentMs = now.getHours() * 60 + now.getMinutes();
    const getMs = (timeString) => {
      if (!timeString) return 0;
      const timeStr = timeString.split(' ')[0];
      if (!timeStr || !timeStr.includes(':')) return 0;
      const [h, m] = timeStr.split(':').map(Number);
      return (isNaN(h) || isNaN(m)) ? 0 : h * 60 + m;
    };

    const prayers = [
      { name: 'Fajr', ms: getMs(times.Fajr) },
      { name: 'Sunrise', ms: getMs(times.Sunrise) },
      { name: 'Dhuhr', ms: getMs(times.Dhuhr) },
      { name: 'Asr', ms: getMs(times.Asr) },
      { name: 'Maghrib', ms: getMs(times.Maghrib) },
      { name: 'Isha', ms: getMs(times.Isha) },
    ];

    let nextPrayer = prayers.find(p => p.ms > currentMs);
    const nextPrayerName = nextPrayer ? nextPrayer.name : 'Fajr';

    let currentPrayer = [...prayers].reverse().find(p => currentMs >= p.ms);
    if (!currentPrayer) {
      currentPrayer = prayers[prayers.length - 1]; // Isha if before Fajr
    }
    const currentPrayerName = currentPrayer.name;

    // 4. Render the widget UI
    props.renderWidget(
      <PrayerWidget
        prayerTimes={times}
        nextPrayerName={nextPrayerName}
        currentPrayerName={currentPrayerName}
        locationName={locationName}
      />
    );
  }
}

/**
 * Triggers a manual update of all active widget instances.
 */
export async function updateAppWidgets() {
  try {
    let lat = 51.5074;
    let lng = -0.1278;
    let asrMethod = 'standard';
    let prayerOffsets = { Fajr: 0, Sunrise: 0, Dhuhr: 0, Asr: 0, Maghrib: 0, Isha: 0 };
    let calculationMethod = 'MuslimWorldLeague';
    let highLatitudeRule = 'Auto';

    let locationName = 'Muslim Atlas';

    const cachedLoc = await AsyncStorage.getItem('@cached_location');
    if (cachedLoc) {
      const parsedLoc = JSON.parse(cachedLoc);
      if (parsedLoc?.latitude && parsedLoc?.longitude) {
        lat = parsedLoc.latitude;
        lng = parsedLoc.longitude;
      }
    }

    const storedLocName = await AsyncStorage.getItem('@cached_location_name');
    if (storedLocName) {
      locationName = storedLocName;
    }

    const storedAsr = await AsyncStorage.getItem(ASR_METHOD_KEY);
    if (storedAsr) asrMethod = storedAsr;

    const storedOffsets = await AsyncStorage.getItem(PRAYER_OFFSETS_KEY);
    if (storedOffsets) prayerOffsets = JSON.parse(storedOffsets);

    const storedCalc = await AsyncStorage.getItem(CALCULATION_METHOD_KEY);
    if (storedCalc) calculationMethod = storedCalc;

    const storedHighLat = await AsyncStorage.getItem(HIGH_LATITUDE_RULE_KEY);
    if (storedHighLat) highLatitudeRule = storedHighLat;

    const now = new Date();
    const times = calculatePrayerTimes(lat, lng, now, {
      asrMethod,
      prayerOffsets,
      calculationMethod,
      highLatitudeRule,
    });

    const currentMs = now.getHours() * 60 + now.getMinutes();
    const getMs = (timeString) => {
      if (!timeString) return 0;
      const timeStr = timeString.split(' ')[0];
      if (!timeStr || !timeStr.includes(':')) return 0;
      const [h, m] = timeStr.split(':').map(Number);
      return (isNaN(h) || isNaN(m)) ? 0 : h * 60 + m;
    };

    const prayers = [
      { name: 'Fajr', ms: getMs(times.Fajr) },
      { name: 'Sunrise', ms: getMs(times.Sunrise) },
      { name: 'Dhuhr', ms: getMs(times.Dhuhr) },
      { name: 'Asr', ms: getMs(times.Asr) },
      { name: 'Maghrib', ms: getMs(times.Maghrib) },
      { name: 'Isha', ms: getMs(times.Isha) },
    ];

    let nextPrayer = prayers.find(p => p.ms > currentMs);
    const nextPrayerName = nextPrayer ? nextPrayer.name : 'Fajr';

    let currentPrayer = [...prayers].reverse().find(p => currentMs >= p.ms);
    if (!currentPrayer) {
      currentPrayer = prayers[prayers.length - 1]; // Isha if before Fajr
    }
    const currentPrayerName = currentPrayer.name;

    requestWidgetUpdate({
      widgetName: 'PrayerWidget',
      renderWidget: () => (
        <PrayerWidget
          prayerTimes={times}
          nextPrayerName={nextPrayerName}
          currentPrayerName={currentPrayerName}
          locationName={locationName}
        />
      ),
    });
  } catch (e) {
    console.warn('Failed to update app widgets:', e);
  }
}
