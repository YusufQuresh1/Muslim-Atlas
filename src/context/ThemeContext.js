import React, { createContext, useState, useEffect, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';

const THEME_STORAGE_KEY = '@mosquemap_theme_preference';

export const lightTheme = {
  mode: 'light',
  background: '#f8fafc',
  card: '#ffffff',
  text: '#0f172a',
  subText: '#64748b',
  border: '#e2e8f0',
  tint: '#059669', // Emerald
  primary: '#059669', // Emerald
  danger: '#ef4444',
  chipBg: '#f1f5f9',
  chipText: '#334155',
  modalBackdrop: 'rgba(0,0,0,0.6)',
  mapboxStyle: 'mapbox://styles/mapbox/streets-v12',
};

export const darkTheme = {
  mode: 'dark',
  background: '#0f172a',
  card: '#1e293b',
  text: '#f8fafc',
  subText: '#94a3b8',
  border: '#334155',
  tint: '#10b981', // Emerald Lighter
  primary: '#10b981', // Emerald (lighter)
  danger: '#f87171',
  chipBg: '#334155',
  chipText: '#f1f5f9',
  modalBackdrop: 'rgba(0,0,0,0.8)',
  mapboxStyle: 'mapbox://styles/mapbox/dark-v11',
};

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const systemColorScheme = useColorScheme(); // 'light' or 'dark'
  const [themeMode, setThemeMode] = useState('system'); // 'light', 'dark', or 'system'
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (stored) {
          setThemeMode(stored);
        }
      } catch (e) {
        console.warn('Failed to load theme preference:', e);
      } finally {
        setIsReady(true);
      }
    };
    loadTheme();
  }, []);

  const setTheme = async (mode) => {
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
      setThemeMode(mode);
    } catch (e) {
      console.warn('Failed to save theme preference:', e);
    }
  };

  const activeMode = themeMode === 'system' ? (systemColorScheme || 'light') : themeMode;
  const theme = activeMode === 'dark' ? darkTheme : lightTheme;

  // Don't render until theme is loaded to prevent flash of wrong colors
  if (!isReady) return null;

  return (
    <ThemeContext.Provider value={{ theme, themeMode, setTheme, activeMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
