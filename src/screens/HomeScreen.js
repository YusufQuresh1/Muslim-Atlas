import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, RefreshControl, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { MosqueContext } from '../context/MosqueContext';
import { useTheme } from '../context/ThemeContext';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { calculatePrayerTimes } from '../utils/prayerEngine';
import { usePrayerSettings } from '../context/PrayerSettingsContext';
import { WidgetPreview } from 'react-native-android-widget';
import { PrayerWidget } from '../widgets/PrayerWidget';
import { updateAppWidgets } from '../../widget-task-handler';

export default function HomeScreen({ navigation }) {
  const { userLocation, searchLocationName, isRefreshing, forceRefreshData } = React.useContext(MosqueContext);
  const { theme } = useTheme();
  const { asrMethod, prayerOffsets, calculationMethod, highLatitudeRule } = usePrayerSettings();
  const [location, setLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [prayerTimes, setPrayerTimes] = useState(null);
  const [prayerDate, setPrayerDate] = useState(null);
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [apiTimings, setApiTimings] = useState(null);

  // Real-time tick for prayer logic & UI clock
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleRefresh = async () => {
    if (location) {
      await fetchPrayerTimes(location.coords.latitude, location.coords.longitude);
    }
    await forceRefreshData();
  };

  const hasFetchedPrayerTimesRef = useRef(false);

  useEffect(() => {
    if (!userLocation || hasFetchedPrayerTimesRef.current) return;
    hasFetchedPrayerTimesRef.current = true;
    const lat = userLocation.coords.latitude;
    const lng = userLocation.coords.longitude;
    fetchPrayerTimes(lat, lng);
  }, [userLocation]);

  useEffect(() => {
    (async () => {
      try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setErrorMsg('Permission to access location was denied');
          return;
        }
        const lastKnown = await Promise.race([
          Location.getLastKnownPositionAsync().catch(() => null),
          new Promise(resolve => setTimeout(() => resolve(null), 500)),
        ]);
        const loc = lastKnown ?? await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
          new Promise(resolve => setTimeout(() => resolve(null), 12000)),
        ]);
        if (loc) {
          setLocation(loc);
          if (!hasFetchedPrayerTimesRef.current) {
            hasFetchedPrayerTimesRef.current = true;
            const lat = loc.coords.latitude;
            const lng = loc.coords.longitude;
            await fetchPrayerTimes(lat, lng);
          }
        }
      } catch (err) {
        console.error(err);
        setErrorMsg('Failed to initialize location data');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Recalculate local prayer times whenever location, custom settings or the date changes
  useEffect(() => {
    const activeLoc = location || userLocation;
    if (activeLoc) {
      const lat = activeLoc.coords.latitude;
      const lng = activeLoc.coords.longitude;
      const times = calculatePrayerTimes(lat, lng, currentTime, {
        asrMethod,
        prayerOffsets,
        calculationMethod,
        highLatitudeRule,
        timeZone: timezone,
      });
      setPrayerTimes(times);
      updateAppWidgets().catch(console.error);
    }
  }, [location, userLocation, asrMethod, prayerOffsets, calculationMethod, highLatitudeRule, timezone, currentTime.getDate()]);

  const fetchPrayerTimes = async (lat, lng) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const today = new Date();
      const day = String(today.getDate()).padStart(2, '0');
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const year = today.getFullYear();
      const dateStr = `${day}-${month}-${year}`;

      const res = await fetch(
        `https://api.aladhan.com/v1/timings/${dateStr}?latitude=${lat}&longitude=${lng}&method=2`,
        { signal: controller.signal }
      );
      const data = await res.json();
      if (data && data.data) {
        if (data.data.date) setPrayerDate(data.data.date);
        if (data.data.timings) setApiTimings(data.data.timings);
        if (data.data.meta?.timezone) {
          setTimezone(data.data.meta.timezone);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Prayer times error:', err);
      }
    } finally {
      clearTimeout(timeout);
      const times = calculatePrayerTimes(lat, lng, currentTime, {
        asrMethod,
        prayerOffsets,
        calculationMethod,
        highLatitudeRule,
        timeZone: timezone,
      });
      setPrayerTimes(times);
    }
  };

  const renderPrayerCard = () => {
    if (!prayerTimes) return null;

    const activeSunrise = apiTimings?.Sunrise ? apiTimings.Sunrise.split(' ')[0] : prayerTimes.Sunrise.split(' ')[0];
    const activeMaghrib = apiTimings?.Maghrib ? apiTimings.Maghrib.split(' ')[0] : prayerTimes.Maghrib.split(' ')[0];

    const prayers = [
      { name: 'Fajr', time: prayerTimes.Fajr },
      { name: 'Dhuhr', time: prayerTimes.Dhuhr },
      { name: 'Asr', time: prayerTimes.Asr },
      { name: 'Maghrib', time: activeMaghrib },
      { name: 'Isha', time: prayerTimes.Isha }
    ];

    const currentMs = currentTime.getHours() * 60 + currentTime.getMinutes();
    const getMs = (timeString) => {
        if (!timeString) return 0;
        const timeStr = timeString.split(' ')[0];
        if (!timeStr || !timeStr.includes(':')) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return (isNaN(h) || isNaN(m)) ? 0 : h * 60 + m;
    };

    const fajrMs = getMs(prayerTimes.Fajr);
    const sunriseMs = getMs(prayerTimes.Sunrise);
    const dhuhrMs = getMs(prayerTimes.Dhuhr);
    const asrMs = getMs(prayerTimes.Asr);
    const maghribMs = getMs(prayerTimes.Maghrib);
    const ishaMs = getMs(prayerTimes.Isha);

    let activeIndex = -1;
    if (currentMs >= fajrMs && currentMs < sunriseMs) activeIndex = 0;
    else if (currentMs >= sunriseMs && currentMs < dhuhrMs) activeIndex = 1; // Sunrise -> Dhuhr highlights Dhuhr next
    else if (currentMs >= dhuhrMs && currentMs < asrMs) activeIndex = 1;
    else if (currentMs >= asrMs && currentMs < maghribMs) activeIndex = 2;
    else if (currentMs >= maghribMs && currentMs < ishaMs) activeIndex = 3;
    else if (currentMs >= ishaMs || currentMs < fajrMs) activeIndex = 4;

    return (
      <LinearGradient 
        colors={['#0369a1', '#075985']} 
        start={{ x: 0, y: 0 }} 
        end={{ x: 1, y: 1 }} 
        style={styles.prayerCard}
      >
        <View style={styles.prayerCardHeader}>
          <View style={styles.prayerCardMeta}>
            <Text style={styles.prayerCardTitle}>Prayer Times</Text>
            {searchLocationName ? (
              <Text style={styles.prayerCardLocation}>
                <Ionicons name="location-sharp" size={13} color="#fff" /> {searchLocationName}
              </Text>
            ) : null}
            {prayerDate && (
              <Text style={styles.prayerCardDate}>
                {prayerDate.hijri?.day} {prayerDate.hijri?.month?.en} {prayerDate.hijri?.year} AH
                {'\n'}{prayerDate.gregorian?.day} {prayerDate.gregorian?.month?.en}
              </Text>
            )}
          </View>
          <View style={styles.prayerCardClockMeta}>
            <Text style={styles.prayerCardClock}>
              {currentTime.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}
            </Text>
            <View style={[styles.sunrisePill, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
              <Text style={styles.sunriseText}>
                <Ionicons name="sunny-outline" size={12} color="#fff" /> Sunrise {activeSunrise}
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.prayerCardDivider, { backgroundColor: 'rgba(255,255,255,0.2)' }]} />

        <View style={styles.prayerRow}>
          {prayers.map((p, i) => {
            const isActive = i === activeIndex;
            return (
              <View key={i} style={[styles.prayerItem, isActive && styles.prayerItemActive]}>
                <Text style={[styles.prayerName, isActive && styles.prayerNameActive]}>{p.name}</Text>
                <Text style={[styles.prayerTime, isActive && styles.prayerTimeActive]}>{p.time.split(' ')[0]}</Text>
              </View>
            );
          })}
        </View>
      </LinearGradient>
    );
  };

  const renderWidgetPreview = React.useCallback(() => {
    if (!prayerTimes) return null;

    const overriddenTimes = {
      ...prayerTimes,
      ...(apiTimings ? { Sunrise: apiTimings.Sunrise, Maghrib: apiTimings.Maghrib } : {})
    };

    const getMs = (timeString) => {
      if (!timeString) return 0;
      const timeStr = timeString.split(' ')[0];
      if (!timeStr || !timeStr.includes(':')) return 0;
      const [h, m] = timeStr.split(':').map(Number);
      return (isNaN(h) || isNaN(m)) ? 0 : h * 60 + m;
    };

    const currentMs = currentTime.getHours() * 60 + currentTime.getMinutes();
    const widgetPrayers = [
      { name: 'Fajr', ms: getMs(overriddenTimes.Fajr) },
      { name: 'Sunrise', ms: getMs(overriddenTimes.Sunrise) },
      { name: 'Dhuhr', ms: getMs(overriddenTimes.Dhuhr) },
      { name: 'Asr', ms: getMs(overriddenTimes.Asr) },
      { name: 'Maghrib', ms: getMs(overriddenTimes.Maghrib) },
      { name: 'Isha', ms: getMs(overriddenTimes.Isha) },
    ];

    const nextWidgetPrayer = widgetPrayers.find(p => p.ms > currentMs);
    const nextWidgetPrayerName = nextWidgetPrayer ? nextWidgetPrayer.name : 'Fajr';

    let currentWidgetPrayer = [...widgetPrayers].reverse().find(p => currentMs >= p.ms);
    if (!currentWidgetPrayer) {
      currentWidgetPrayer = widgetPrayers[widgetPrayers.length - 1]; // Isha if before Fajr
    }
    const currentWidgetPrayerName = currentWidgetPrayer.name;

    return (
      <PrayerWidget
        prayerTimes={overriddenTimes}
        nextPrayerName={nextWidgetPrayerName}
        currentPrayerName={currentWidgetPrayerName}
        locationName={searchLocationName || 'Muslim Atlas'}
      />
    );
  }, [prayerTimes, apiTimings, searchLocationName, currentTime.getHours(), currentTime.getMinutes()]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: theme.background }]} edges={['top']}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={[styles.loadingText, { color: theme.text }]}>Loading Hub...</Text>
      </SafeAreaView>
    );
  }

  if (errorMsg) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: theme.background }]} edges={['top']}>
        <Text style={[styles.errorText, { color: theme.danger }]}>{errorMsg}</Text>
      </SafeAreaView>
    );
  }

  const utilities = [
    { id: 'qibla', title: 'Qibla', icon: 'compass-outline', type: 'ion', color: '#6366f1', action: () => Alert.alert('Coming Soon', 'Qibla compass is under development.') },
    { id: 'quran', title: 'Quran', icon: 'book-open-page-variant-outline', type: 'mci', color: '#10b981', action: () => Alert.alert('Coming Soon', 'Quran reading features are under development.') },
    { id: 'tracker', title: 'Tracker', icon: 'calendar-check-outline', type: 'mci', color: '#f59e0b', action: () => Alert.alert('Coming Soon', 'Track your daily prayers in an upcoming update.') },
    { id: 'tasbih', title: 'Tasbih', icon: 'counter', type: 'mci', color: '#f43f5e', action: () => Alert.alert('Coming Soon', 'Digital Tasbih counter coming soon.') },
  ];

  const utilityShadow = { 
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: theme.mode === 'dark' ? 0.3 : 0.05,
    shadowRadius: 8,
    elevation: 2,
  };

  const primaryShadow = {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  };


  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView 
        contentContainerStyle={styles.scrollContent} 
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
      >
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Home</Text>
        </View>

        {renderPrayerCard()}

        <View style={styles.utilityGrid}>
          {utilities.map(u => (
            <TouchableOpacity 
              key={u.id} 
              style={[
                styles.utilityCard, 
                { 
                  backgroundColor: u.color, 
                  borderColor: u.color,
                  borderWidth: 1,
                  ...Platform.select({
                    ios: {
                      shadowColor: u.color,
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.2,
                      shadowRadius: 6,
                    },
                    android: {
                      elevation: 3,
                    }
                  })
                }
              ]} 
              activeOpacity={0.8}
              onPress={u.action}
            >
              <View style={[styles.utilityIconWrapper, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                {u.type === 'ion' ? (
                  <Ionicons name={u.icon} size={22} color="#ffffff" />
                ) : (
                  <MaterialCommunityIcons name={u.icon} size={22} color="#ffffff" />
                )}
              </View>
              <Text 
                style={[
                  styles.utilityTitle, 
                  { color: '#ffffff' }
                ]} 
                numberOfLines={1}
              >
                {u.title}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.primaryStack}>
          <TouchableOpacity 
            activeOpacity={0.9}
            style={[styles.primaryCardContainer, primaryShadow]}
            onPress={() => navigation.navigate('Map', { viewMode: 'list', activeCategory: 'mosque' })}
          >
            <LinearGradient
              colors={['#059669', '#0F766E']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryGradient}
            >
              <MaterialCommunityIcons 
                name="mosque" 
                size={150} 
                color="rgba(255,255,255,0.12)" 
                style={styles.cardWatermark} 
              />
              <View style={styles.primaryIconContainer}>
                <View style={[styles.whiteIconBg, { backgroundColor: '#A7F3D0' }]}>
                  <MaterialCommunityIcons name="mosque" size={30} color="#065F46" />
                </View>
              </View>
              <View style={styles.primaryTextContainer}>
                <Text style={styles.primaryTitle}>Find Mosques</Text>
                <Text style={styles.primarySubtitle}>Locate nearby prayer spaces</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity 
            activeOpacity={0.9}
            style={[styles.primaryCardContainer, primaryShadow]}
            onPress={() => navigation.navigate('Map', { viewMode: 'list', activeCategory: 'food' })}
          >
            <LinearGradient
              colors={['#EA580C', '#C2410C']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryGradient}
            >
              <MaterialCommunityIcons 
                name="silverware-fork-knife" 
                size={150} 
                color="rgba(255,255,255,0.12)" 
                style={styles.cardWatermark} 
              />
              <View style={styles.primaryIconContainer}>
                <View style={[styles.whiteIconBg, { backgroundColor: '#FFEDD5' }]}>
                  <MaterialCommunityIcons name="silverware-fork-knife" size={30} color="#9A3412" />
                </View>
              </View>
              <View style={styles.primaryTextContainer}>
                <Text style={styles.primaryTitle}>Find Halal Food</Text>
                <Text style={styles.primarySubtitle}>Discover local halal eateries</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {prayerTimes && (
          <View style={{ paddingHorizontal: 20, marginBottom: 20, alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: theme.text, marginBottom: 12, alignSelf: 'flex-start' }}>
              Widget Preview (4x2)
            </Text>
            <WidgetPreview
              renderWidget={renderWidgetPreview}
              width={320}
              height={140}
            />
          </View>
        )}
        
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 16, fontWeight: '600' },
  errorText: { fontSize: 16, fontWeight: '600', textAlign: 'center', padding: 20 },
  scrollContent: { paddingBottom: 20 },
  header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16 },
  headerTitle: { fontSize: 32, fontWeight: '800' },
  
  prayerCard: {
    marginHorizontal: 20,
    borderRadius: 24,
    padding: 24,
    marginBottom: 24,
    minHeight: 120, // Safety
    ...Platform.select({
      ios: {
        shadowColor: '#0369a1',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.2,
        shadowRadius: 15,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  prayerCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  prayerCardMeta: { flex: 1, paddingRight: 10 },
  prayerCardTitle: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 4 },
  prayerCardLocation: { fontSize: 13, color: '#D1FAE5', fontWeight: '700', marginBottom: 6 },
  prayerCardDate: { fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: '500', lineHeight: 20 },
  prayerCardClockMeta: { alignItems: 'flex-end', justifyContent: 'center' },
  prayerCardClock: {
    fontSize: 32,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 8,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  sunrisePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  sunriseText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  prayerCardDivider: { height: 1, marginVertical: 12 },
  prayerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  prayerItem: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 6, borderRadius: 16, flex: 1 },
  prayerItemActive: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 16, overflow: 'hidden' },
  prayerName: { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 4, fontWeight: '700' },
  prayerNameActive: { color: '#fff' },
  prayerTime: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  prayerTimeActive: { color: '#fff', fontSize: 16, fontWeight: '900' },
  
  primaryStack: {
    paddingHorizontal: 20,
    gap: 16,
    marginBottom: 24,
  },
  primaryCardContainer: {
    borderRadius: 24,
    overflow: 'hidden',
    width: '100%',
    alignSelf: 'stretch',
  },
  primaryGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 24,
    borderRadius: 24,
    minHeight: 110, // Safety
  },
  cardWatermark: {
    position: 'absolute',
    right: -30,
    bottom: -40,
  },
  primaryIconContainer: {
    marginRight: 18,
  },
  whiteIconBg: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryTextContainer: {
    flex: 1,
  },
  primaryTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  primarySubtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.8)',
  },
  utilityGrid: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 8,
    justifyContent: 'space-between',
    marginBottom: 20, // Final spacing refinement
  },
  utilityCard: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  utilityIconWrapper: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.02)',
    borderRadius: 20,
    marginBottom: 6,
  },
  utilityTitle: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
});
