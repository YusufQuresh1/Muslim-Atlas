import 'react-native-gesture-handler'; // MUST BE THE FIRST LINE
import React from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import HomeScreen from './src/screens/HomeScreen';
import MapScreen from './src/screens/MapScreen';
import SettingsScreen from './src/components/SettingsScreen';
import { MosqueProvider } from './src/context/MosqueContext';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { PrayerSettingsProvider } from './src/context/PrayerSettingsContext';
import Mapbox from '@rnmapbox/maps';

Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN);
Mapbox.setTelemetryEnabled(false);

const Tab = createBottomTabNavigator();

const MainNavigator = () => {
  const { theme } = useTheme();
  
  const navTheme = {
    dark: theme.mode === 'dark',
    colors: {
      primary: theme.primary,
      background: theme.background,
      card: theme.primary, // Using primary for the header background
      text: '#FFFFFF',     // Header text white
      border: 'transparent',
      notification: theme.primary,
    },
    fonts: Platform.select({
      ios: {
        regular: { fontFamily: 'System', fontWeight: '400' },
        medium: { fontFamily: 'System', fontWeight: '500' },
        bold: { fontFamily: 'System', fontWeight: '700' },
        heavy: { fontFamily: 'System', fontWeight: '900' },
      },
      default: {
        regular: { fontFamily: 'sans-serif', fontWeight: 'normal' },
        medium: { fontFamily: 'sans-serif-medium', fontWeight: 'normal' },
        bold: { fontFamily: 'sans-serif', fontWeight: 'bold' },
        heavy: { fontFamily: 'sans-serif', fontWeight: 'bold' },
      },
    }),
  };
  
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <NavigationContainer theme={navTheme}>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarStyle: {
              backgroundColor: theme.card,
              borderTopColor: theme.border,
            },
            tabBarIcon: ({ focused, color, size }) => {
              let iconName;
              if (route.name === 'Home') {
                iconName = focused ? 'home' : 'home-outline';
              } else if (route.name === 'Map') {
                iconName = focused ? 'map' : 'map-outline';
              } else if (route.name === 'Profile') {
                iconName = focused ? 'person' : 'person-outline';
              }
              return <Ionicons name={iconName} size={size} color={color} />;
            },
            tabBarActiveTintColor: theme.primary,
            tabBarInactiveTintColor: theme.subText,
          })}
        >
          <Tab.Screen name="Home" component={HomeScreen} />
          <Tab.Screen name="Map" component={MapScreen} />
          <Tab.Screen name="Profile" component={SettingsScreen} />
        </Tab.Navigator>
      </NavigationContainer>
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
    </View>
  );
};

export default function App() {
  const [isReady, setIsReady] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setIsReady(true), 100);
    return () => clearTimeout(t);
  }, []);

  if (!isReady) {
    return <View style={{ flex: 1, backgroundColor: '#ffffff' }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <PrayerSettingsProvider>
          <AuthProvider>
            <MosqueProvider>
              <SafeAreaProvider>
                <MainNavigator />
              </SafeAreaProvider>
            </MosqueProvider>
          </AuthProvider>
        </PrayerSettingsProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});