import React, { createContext, useState, useEffect, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { updateAppWidgets } from '../../widget-task-handler';

const ASR_METHOD_KEY = '@muslimatlas_asr_method';
const PRAYER_OFFSETS_KEY = '@muslimatlas_prayer_offsets';
const CALCULATION_METHOD_KEY = '@muslimatlas_calc_method';
const HIGH_LATITUDE_RULE_KEY = '@muslimatlas_high_lat_rule';

const DEFAULT_OFFSETS = {
  Fajr: 0,
  Sunrise: 0,
  Dhuhr: 0,
  Asr: 0,
  Maghrib: 0,
  Isha: 0,
};

const PrayerSettingsContext = createContext();

export const PrayerSettingsProvider = ({ children }) => {
  const [asrMethod, setAsrMethodState] = useState('standard'); // 'standard' or 'hanafi'
  const [prayerOffsets, setPrayerOffsetsState] = useState(DEFAULT_OFFSETS);
  const [calculationMethod, setCalculationMethodState] = useState('MuslimWorldLeague');
  const [highLatitudeRule, setHighLatitudeRuleState] = useState('Auto');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const storedAsr = await AsyncStorage.getItem(ASR_METHOD_KEY);
        const storedOffsets = await AsyncStorage.getItem(PRAYER_OFFSETS_KEY);
        const storedCalc = await AsyncStorage.getItem(CALCULATION_METHOD_KEY);
        const storedHighLat = await AsyncStorage.getItem(HIGH_LATITUDE_RULE_KEY);
        
        if (storedAsr) {
          setAsrMethodState(storedAsr);
        }
        if (storedOffsets) {
          try {
            setPrayerOffsetsState(JSON.parse(storedOffsets));
          } catch (e) {
            console.error('Failed to parse stored offsets:', e);
          }
        }
        if (storedCalc) {
          setCalculationMethodState(storedCalc);
        }
        if (storedHighLat) {
          setHighLatitudeRuleState(storedHighLat);
        }
      } catch (e) {
        console.warn('Failed to load prayer settings:', e);
      } finally {
        setIsReady(true);
      }
    };
    loadSettings();
  }, []);

  const setAsrMethod = async (method) => {
    try {
      await AsyncStorage.setItem(ASR_METHOD_KEY, method);
      setAsrMethodState(method);
      updateAppWidgets().catch(console.warn);
    } catch (e) {
      console.warn('Failed to save Asr method preference:', e);
    }
  };

  const setCalculationMethod = async (method) => {
    try {
      await AsyncStorage.setItem(CALCULATION_METHOD_KEY, method);
      setCalculationMethodState(method);
      updateAppWidgets().catch(console.warn);
    } catch (e) {
      console.warn('Failed to save calculation method preference:', e);
    }
  };

  const setHighLatitudeRule = async (rule) => {
    try {
      await AsyncStorage.setItem(HIGH_LATITUDE_RULE_KEY, rule);
      setHighLatitudeRuleState(rule);
      updateAppWidgets().catch(console.warn);
    } catch (e) {
      console.warn('Failed to save high latitude rule preference:', e);
    }
  };

  const updatePrayerOffset = async (prayerName, offsetValue) => {
    try {
      const newOffsets = {
        ...prayerOffsets,
        [prayerName]: parseInt(offsetValue, 10) || 0,
      };
      await AsyncStorage.setItem(PRAYER_OFFSETS_KEY, JSON.stringify(newOffsets));
      setPrayerOffsetsState(newOffsets);
      updateAppWidgets().catch(console.warn);
    } catch (e) {
      console.warn('Failed to save prayer offset:', e);
    }
  };

  const setPrayerOffsets = async (offsets) => {
    try {
      await AsyncStorage.setItem(PRAYER_OFFSETS_KEY, JSON.stringify(offsets));
      setPrayerOffsetsState(offsets);
      updateAppWidgets().catch(console.warn);
    } catch (e) {
      console.warn('Failed to save prayer offsets:', e);
    }
  };

  if (!isReady) return null;

  return (
    <PrayerSettingsContext.Provider
      value={{
        asrMethod,
        prayerOffsets,
        calculationMethod,
        highLatitudeRule,
        setAsrMethod,
        updatePrayerOffset,
        setPrayerOffsets,
        setCalculationMethod,
        setHighLatitudeRule,
      }}
    >
      {children}
    </PrayerSettingsContext.Provider>
  );
};

export const usePrayerSettings = () => useContext(PrayerSettingsContext);
