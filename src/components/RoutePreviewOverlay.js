import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, ScrollView,
  ActivityIndicator, Modal, TextInput, FlatList, KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { MosqueContext } from '../context/MosqueContext';

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function walkMins(meters) { return Math.max(1, Math.round(meters / 80)); }

function formatDistance(meters) {
  if (!meters) return '—';
  const miles = meters * 0.000621371;
  return miles >= 0.1 ? `${miles.toFixed(1)} mi` : `${Math.round(meters * 3.28084)} ft`;
}

function formatTimeDiff(totalMins) {
  if (totalMins < 60) return `${totalMins} min`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

const MODES = [
  { key: 'driving-traffic', label: 'Drive',   icon: '🚗' },
  { key: 'walking',         label: 'Walk',    icon: '🚶' },
  { key: 'transit',         label: 'Transit', icon: '🚇' },
];

export default function RoutePreviewOverlay({
  mosque,
  activeCategory = 'mosque',
  selectedMode,
  onModeChange,
  transitChain,
  durationText,
  loading,
  onBack,
  onStart,
  onDestinationChange,
  distance,
  estimatedTimes,
  startLabel,
  onStartLocationChange,
  nextPrayer,
}) {
  const insets = useSafeAreaInsets();
  const { appendParkingToCache, fetchMosqueDeepData } = useContext(MosqueContext);

  const [parkingLots, setParkingLots] = useState([]);
  const [parkingLoading, setParkingLoading] = useState(false);
  const [parkingExpanded, setParkingExpanded] = useState(false);
  const [activeDestination, setActiveDestination] = useState(null);
  const [showStartSearch, setShowStartSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef(null);

  // ── Parking: only fetch when dropdown is expanded, cache-first ──
  useEffect(() => {
    if (selectedMode !== 'driving-traffic') return;
    if (!parkingExpanded) return;          // lazy — wait for user to open
    if (parkingLots.length > 0) return;    // already loaded
    if (!mosque?.location) return;
    const { latitude, longitude } = mosque.location;

    const enrichAndSort = (lots) =>
      lots
        .map(p => {
          const distToMosque = haversineM(latitude, longitude, p.lat, p.lng);
          return { ...p, distToMosque, walkMinsToMosque: walkMins(distToMosque) };
        })
        .sort((a, b) => a.distToMosque - b.distToMosque);

    // 1. Try deep cache first (instant, no API cost)
    fetchMosqueDeepData(mosque).then(cached => {
      if (cached?.parking?.length > 0) {
        setParkingLots(enrichAndSort(cached.parking));
        return;
      }
      // 2. Cache miss — fetch from Places API
      setParkingLoading(true);
      fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress',
        },
        body: JSON.stringify({
          includedTypes: ['parking'],
          maxResultCount: 8,
          locationRestriction: {
            circle: { center: { latitude, longitude }, radius: 1000.0 },
          },
        }),
      })
        .then(r => r.json())
        .then(data => {
          const raw = (data.places || []).map(p => ({
            id: p.id, name: p.displayName?.text,
            address: p.formattedAddress,
            lat: p.location.latitude, lng: p.location.longitude,
          }));
          const enriched = enrichAndSort(raw);
          setParkingLots(enriched);
          if (mosque?.id) appendParkingToCache(mosque.id, enriched);
        })
        .catch(err => console.error('Parking fetch error:', err))
        .finally(() => setParkingLoading(false));
    });
  }, [mosque, selectedMode, parkingExpanded]);

  useEffect(() => {
    if (selectedMode !== 'driving-traffic') {
      setActiveDestination(null);
      if (onDestinationChange) onDestinationChange(mosque);
    }
  }, [selectedMode, mosque]);

  const handleSearchChange = useCallback((text) => {
    setSearchQuery(text);
    clearTimeout(searchTimer.current);
    if (!text.trim()) { setSuggestions([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        let locationBias = {};
        if (mosque?.location) {
          locationBias = { locationBias: { circle: { center: { latitude: mosque.location.latitude, longitude: mosque.location.longitude }, radius: 50000.0 } } };
        }
        const url = 'https://places.googleapis.com/v1/places:autocomplete';
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY
          },
          body: JSON.stringify({
            input: text,
            ...locationBias
          })
        });
        const data = await res.json();
        setSuggestions(data.suggestions ?? []);
      } catch (err) {
        console.error('Autocomplete error:', err);
      } finally {
        setSearchLoading(false);
      }
    }, 400);
  }, []);

  const handleSelectPlace = useCallback(async (suggestion) => {
    try {
      const placeId = suggestion.placePrediction?.placeId;
      if (!placeId) return;

      const url = `https://places.googleapis.com/v1/places/${placeId}?fields=location,formattedAddress`;
      const res = await fetch(url, {
        headers: { 'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY }
      });
      const data = await res.json();
      const { latitude: lat, longitude: lng } = data.location;
      onStartLocationChange(lat, lng, data.formattedAddress ?? suggestion.placePrediction?.text?.text);
    } catch (err) {
      console.error('Place details error:', err);
    } finally {
      setShowStartSearch(false);
      setSearchQuery('');
      setSuggestions([]);
    }
  }, [onStartLocationChange]);

  const closeSearch = useCallback(() => {
    setShowStartSearch(false);
    setSearchQuery('');
    setSuggestions([]);
  }, []);

  const handleStart = useCallback(() => onStart(selectedMode, activeDestination), [onStart, selectedMode, activeDestination]);

  if (!mosque) return null;

  // Parse real minutes from the Google Directions text (e.g. "8 mins", "1 hour 5 mins")
  const parsedDurationMins = (() => {
    if (!durationText) return null;
    let total = 0;
    const hours = durationText.match(/(\d+)\s*h/);
    const mins  = durationText.match(/(\d+)\s*m/);
    if (hours) total += parseInt(hours[1]) * 60;
    if (mins)  total += parseInt(mins[1]);
    return total > 0 ? total : null;
  })();

  const hasParking = !!activeDestination;
  // Use parsed real value first, fall back to rough estimate
  const driveMinutes = parsedDurationMins ?? estimatedTimes?.[selectedMode];
  const walkMinsExtra = hasParking ? (activeDestination.walkMinsToMosque ?? 0) : 0;
  const walkDistExtra = hasParking ? (activeDestination.distToMosque ?? 0) : 0;

  // Combined totals for display
  const totalMinutes = driveMinutes != null ? driveMinutes + walkMinsExtra : null;
  const totalDistanceM = (distance ?? 0) + walkDistExtra;
  const activeMinutes = totalMinutes; // used in stats + arrival
  const activeModeConfig = MODES.find((m) => m.key === selectedMode);
  const isTransit = selectedMode === 'transit';

  const arrivalTime = (() => {
    if (activeMinutes == null) return '—';
    const d = new Date();
    d.setMinutes(d.getMinutes() + activeMinutes);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  })();

  const arrivalStatus = (() => {
    if (!activeMinutes || !nextPrayer?.timeObj) return null;
    const arrivalMs = Date.now() + activeMinutes * 60000;
    const targetMs = nextPrayer.timeObj.getTime();
    const diffMins = Math.round(Math.abs(arrivalMs - targetMs) / 60000);
    const diffLabel = formatTimeDiff(diffMins);
    return arrivalMs <= targetMs
      ? { status: 'SAFE', message: `Arrives ${diffLabel} before ${nextPrayer.name}` }
      : { status: 'LATE', message: `Arrives ${diffLabel} after ${nextPrayer.name}` };
  })();

  return (
    // absoluteFill overlay — transparent middle passes touches to the map below
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">

      {/* ── TOP SECTION: back + from/to + mode tabs ── */}
      <View style={[styles.topSection, { paddingTop: insets.top + 8 }]} pointerEvents="auto">

        {/* Back + From/To row */}
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.8}>
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </TouchableOpacity>

          <View style={styles.fromToSection}>
            {/* From */}
            <TouchableOpacity style={styles.originRow} onPress={() => setShowStartSearch(true)} activeOpacity={0.7}>
              <View style={styles.dotBlue} />
              <Text style={styles.originLabel} numberOfLines={1}>{startLabel}</Text>
              <View style={styles.editChip}>
                <Text style={styles.editChipText}>Edit</Text>
              </View>
            </TouchableOpacity>
            {/* Via parking stop */}
            {activeDestination && (
              <>
                <View style={styles.routeConnector} />
                <View style={[styles.originRow, { opacity: 0.85 }]}>
                  <MaterialCommunityIcons name="parking" size={16} color={theme.text} style={{marginRight: 4}} />
                  <Text style={[styles.originLabel, { color: '#1565C0' }]} numberOfLines={1}>{activeDestination.name}</Text>
                  <Text style={styles.viaTag}>Stop</Text>
                </View>
              </>
            )}
            <View style={styles.routeConnector} />
            {/* To */}
            <View style={styles.originRow}>
              <View style={styles.dotGreen} />
              <Text style={styles.originLabel} numberOfLines={1}>
                <MaterialCommunityIcons name={activeCategory === 'food' ? 'silverware-fork-knife' : 'mosque'} size={18} color={theme.text} /> {mosque.displayName?.text || mosque.name}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Mode tabs */}
        <View style={styles.modeRow}>
          {MODES.map((mode) => {
            const isActive = mode.key === selectedMode;
            const mins = estimatedTimes?.[mode.key];
            const displayTime = (() => {
              if (isActive) {
                if (loading) return null; // spinner shown instead
                if (hasParking && totalMinutes != null) return `${totalMinutes} min`;
                if (durationText) return durationText;
              }
              return mins ? `~${mins} min` : '—';
            })();
            return (
              <TouchableOpacity
                key={mode.key}
                style={[styles.modeTab, isActive && styles.modeTabActive]}
                onPress={() => onModeChange(mode.key)}
                activeOpacity={0.75}
              >
                <Ionicons name={mode.iconName} size={26} color={isActive ? theme.primary : theme.text} style={styles.modeIcon} />
                <Text style={[styles.modeName, isActive && styles.modeNameActive]}>{mode.label}</Text>
                {loading && isActive
                  ? <ActivityIndicator size="small" color="#2e7d32" style={{ marginTop: 2 }} />
                  : <Text style={[styles.modeTime, isActive && styles.modeTimeActive]}>{displayTime}</Text>
                }
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── TRANSPARENT MIDDLE: map visible through here ── */}
      <View style={styles.mapSpacer} pointerEvents="box-none" />

      {/* ── BOTTOM SECTION: stats + button ── */}
      <View style={[styles.bottomSection, { paddingBottom: insets.bottom + 12 }]} pointerEvents="auto">

        {/* Transit steps */}
        {isTransit && (
          <ScrollView style={styles.transitScroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
            {loading ? (
              <View style={styles.transitLoadingRow}>
                <ActivityIndicator color="#1565C0" />
                <Text style={styles.transitLoadingText}>Fetching transit route…</Text>
              </View>
            ) : transitChain.length > 0 ? (
              <>
                {transitChain.map((seg, idx) => (
                  <View key={idx} style={styles.stepRow}>
                    <View style={styles.stepIconCol}>
                      <Text style={styles.stepIcon}>{seg.icon}</Text>
                      {idx < transitChain.length - 1 && <View style={styles.stepConnector} />}
                    </View>
                    <View style={styles.stepInfo}>
                      <Text style={styles.stepPrimary}>{seg.type === 'transit' ? seg.label : 'Walk'}</Text>
                      {(seg.stops || seg.label) && <Text style={styles.stepSub}>{seg.stops || seg.label}</Text>}
                    </View>
                  </View>
                ))}
                <Text style={styles.transitNote}>Opens Google Maps for live transit guidance</Text>
              </>
            ) : (
              <Text style={styles.noRouteText}>No transit route found for this area.</Text>
            )}
          </ScrollView>
        )}

        {/* ── PARKING SECTION ── */}
        {selectedMode === 'driving-traffic' && (
          <View style={styles.parkingCard_section}>
            <TouchableOpacity
              style={styles.parkingHeader}
              onPress={() => setParkingExpanded(e => !e)}
              activeOpacity={0.7}
            >
              <Text style={styles.parkingTitle}><MaterialCommunityIcons name="parking" size={16} color="#4CAF50" /> Nearby Parking</Text>
              <Text style={styles.parkingChevron}>{parkingExpanded ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            {parkingExpanded && (
              parkingLoading ? (
                <ActivityIndicator size="small" color="#2e7d32" style={{ marginTop: 8 }} />
              ) : parkingLots.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                  {parkingLots.map((lot) => {
                    const isSelected = activeDestination?.id === lot.id;
                    return (
                      <TouchableOpacity
                        key={lot.id}
                        onPress={() => {
                          if (isSelected) {
                            setActiveDestination(null);
                            if (onDestinationChange) onDestinationChange(mosque);
                          } else {
                            setActiveDestination(lot);
                            if (onDestinationChange) onDestinationChange(lot);
                          }
                        }}
                        style={[styles.parkingCard, isSelected && styles.parkingCardSelected]}
                        activeOpacity={0.75}
                      >
                        <Text style={styles.parkingCardName} numberOfLines={2}>{lot.name}</Text>
                        <Text style={styles.parkingCardWalk}><Ionicons name="walk-outline" size={14} color="#FF9800" /> {lot.walkMinsToMosque ?? walkMins(lot.distToMosque)} min walk</Text>
                        <Text style={[styles.parkingCardIcon, isSelected && styles.parkingCardIconSelected]}>
                          {isSelected ? '✓' : '+'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              ) : (
                <Text style={[styles.noDataText, { marginTop: 6 }]}>No public parking found within 1 mile</Text>
              )
            )}
          </View>
        )}
        {/* ── JOURNEY INFO SECTION ── */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionLine} />
          <Text style={styles.sectionLabel}>Your Journey</Text>
          <View style={styles.sectionLine} />
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statVal}>{formatDistance(totalDistanceM || distance)}</Text>
            <Text style={styles.statLbl}>Distance</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statVal}>
              {hasParking && totalMinutes != null
                ? `${totalMinutes} min`
                : (durationText && !loading ? durationText : `${driveMinutes ?? '?'} min`)}
            </Text>
            <Text style={styles.statLbl}>{hasParking ? 'Drive + Walk' : activeModeConfig?.label}</Text>
          </View>
          {!isTransit && (
            <>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statVal}>{arrivalTime}</Text>
                <Text style={styles.statLbl}>Arrival</Text>
              </View>
            </>
          )}
        </View>
        {hasParking && (
          <Text style={styles.parkingJourneySub}>
            <Ionicons name="car-outline" size={16} color={theme.text} /> {driveMinutes ?? '?'} min to car park + <Ionicons name="walk-outline" size={16} color={theme.text} /> {walkMinsExtra} min walk to mosque
          </Text>
        )}

        {arrivalStatus && (
          <Text style={[styles.warningText, arrivalStatus.status === 'SAFE' ? styles.warningSafe : styles.warningLate]}>
            {arrivalStatus.message}
          </Text>
        )}


        {/* Start button */}
        <TouchableOpacity
          style={[styles.startBtn, isTransit && styles.startBtnTransit]}
          onPress={handleStart}
          activeOpacity={0.85}
          disabled={loading}
        >
          <Ionicons name={isTransit ? 'map-outline' : hasParking ? 'car-outline' : 'navigate'} size={20} color="#fff" style={styles.startIcon} />
          <Text style={styles.startText}>
            {isTransit ? 'Open in Google Maps' : hasParking ? 'Drive to Car Park' : 'Start Navigation'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Start Location Search Modal ── */}
      <Modal visible={showStartSearch} animationType="slide" transparent={false}>
        <KeyboardAvoidingView style={styles.searchModal} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.searchHeader}>
            <View style={styles.searchInputWrap}>
              <Ionicons name="search" size={20} color="#888" style={{marginRight: 8}} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search for a start location…"
                placeholderTextColor="#aaa"
                value={searchQuery}
                onChangeText={handleSearchChange}
                autoFocus
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
            </View>
            <TouchableOpacity onPress={closeSearch} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.useCurrentRow}
            onPress={() => { onStartLocationChange(null, null, 'Your Location'); closeSearch(); }}
          >
            <Ionicons name="location-sharp" size={20} color={theme.primary} style={{marginRight: 10}} />
            <Text style={styles.useCurrentLabel}>Use Your Current Location</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          {searchLoading ? (
            <ActivityIndicator style={{ marginTop: 24 }} color="#2e7d32" />
          ) : (
            <FlatList
              data={suggestions}
              keyExtractor={(item, idx) => item.placePrediction?.placeId || idx.toString()}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const pred = item.placePrediction;
                if (!pred) return null;
                return (
                  <TouchableOpacity style={styles.suggestionRow} onPress={() => handleSelectPlace(item)}>
                    <Text style={styles.suggestionIcon}>📌</Text>
                    <View style={styles.suggestionInfo}>
                      <Text style={styles.suggestionMain} numberOfLines={1}>
                        {pred.structuredFormat?.mainText?.text ?? pred.text?.text}
                      </Text>
                      <Text style={styles.suggestionSub} numberOfLines={1}>
                        {pred.structuredFormat?.secondaryText?.text ?? ''}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={styles.suggestionDivider} />}
            />
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Top section ──
  topSection: {
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingBottom: 0,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#f5f5f5',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  backIcon: { fontSize: 20, color: '#111', fontWeight: 'bold' },
  fromToSection: { flex: 1 },
  originRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  dotBlue: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#4A90E2', flexShrink: 0 },
  dotGreen: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2e7d32', flexShrink: 0 },
  originLabel: { flex: 1, fontSize: 14, color: '#222', fontWeight: '500' },
  editChip: { backgroundColor: '#e3f2fd', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  editChipText: { fontSize: 12, fontWeight: '700', color: '#1565C0' },
  routeConnector: { width: 2, height: 10, backgroundColor: '#ddd', marginLeft: 4, marginVertical: 1 },
  viaIcon: { fontSize: 13, width: 18, textAlign: 'center', flexShrink: 0 },
  viaTag: {
    fontSize: 10, fontWeight: '800', color: '#1565C0',
    backgroundColor: '#e3f2fd', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
  },
  parkingJourneySub: {
    fontSize: 11, color: '#555', textAlign: 'center',
    marginTop: -4, marginBottom: 6,
  },
  divider: { height: 1, backgroundColor: '#f0f0f0', marginBottom: 8 },
  modeRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  modeTab: {
    flex: 1, alignItems: 'center', paddingVertical: 5,
    borderRadius: 10, borderWidth: 2, borderColor: 'transparent', backgroundColor: '#f5f5f5',
  },
  modeTabActive: { borderColor: '#2e7d32', backgroundColor: '#f0faf0' },
  modeIcon: { fontSize: 14, marginBottom: 1 },
  modeName: { fontSize: 10, fontWeight: '600', color: '#666' },
  modeNameActive: { color: '#2e7d32' },
  modeTime: { fontSize: 11, fontWeight: '800', color: '#222', marginTop: 1 },
  modeTimeActive: { color: '#1b5e20' },

  // ── Transparent middle ──
  mapSpacer: { flex: 1 },

  // ── Bottom section ──
  bottomSection: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 14,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 8,
  },
  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f9f9f9', borderRadius: 12,
    paddingVertical: 10, marginBottom: 10,
  },
  stat: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: 14, fontWeight: '800', color: '#111' },
  statLbl: { fontSize: 12, color: '#757575', marginTop: 3, fontWeight: '500' },
  statDivider: { width: 1, height: 28, backgroundColor: '#e0e0e0' },
  warningText: {
    fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: 8,
  },
  warningSafe: { color: '#2e7d32' },
  warningLate: { color: '#d32f2f' },
  transitScroll: { maxHeight: 110, marginBottom: 8 },
  transitLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  transitLoadingText: { fontSize: 14, color: '#666' },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4, minHeight: 30 },
  stepIconCol: { alignItems: 'center', width: 30, marginRight: 10 },
  stepIcon: { fontSize: 16 },
  stepConnector: { flex: 1, width: 2, backgroundColor: '#e0e0e0', minHeight: 8, marginTop: 2 },
  stepInfo: { flex: 1, paddingTop: 1 },
  stepPrimary: { fontSize: 13, fontWeight: '600', color: '#111' },
  stepSub: { fontSize: 12, color: '#888', marginTop: 1 },
  transitNote: {
    fontSize: 11, color: '#b08011', backgroundColor: '#fff8e1',
    padding: 8, borderRadius: 8, marginTop: 4, marginBottom: 4,
  },
  noRouteText: { fontSize: 14, color: '#888', paddingVertical: 10, textAlign: 'center' },
  parkingCard_section: {
    backgroundColor: '#eaedf2',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d0d5dd',
    padding: 10,
    marginBottom: 10,
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8,
  },
  sectionLine: { flex: 1, height: 1, backgroundColor: '#e0e0e0' },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: '#aaa', letterSpacing: 0.8, textTransform: 'uppercase' },
  parkingHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 6,
  },
  parkingTitle: { fontSize: 13, fontWeight: '700', color: '#555' },
  parkingChevron: { fontSize: 12, color: '#999', fontWeight: '700' },
  noDataText: { fontSize: 13, color: '#bbb', fontStyle: 'italic' },
  parkingCard: {
    backgroundColor: '#fff', borderRadius: 10,
    padding: 10, paddingRight: 36,
    marginRight: 8, width: 150, borderWidth: 2, borderColor: 'transparent',
  },
  parkingCardSelected: { borderColor: '#2e7d32', backgroundColor: '#f0faf0' },
  parkingCardName: { fontSize: 12, fontWeight: '600', color: '#111', marginBottom: 2 },
  parkingCardWalk: { fontSize: 11, color: '#2e7d32', fontWeight: '600' },
  parkingCardRow: {}, // unused — kept for safety
  parkingCardIcon: {
    position: 'absolute', top: 8, right: 8,
    fontSize: 12, fontWeight: '900', color: '#aaa',
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#ddd',
    textAlign: 'center', lineHeight: 17,
  },
  parkingCardIconSelected: { color: '#2e7d32', borderColor: '#2e7d32' },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#2e7d32', borderRadius: 14, paddingVertical: 14, gap: 10,
    shadowColor: '#2e7d32', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 5,
  },
  startBtnTransit: { backgroundColor: '#1565C0', shadowColor: '#1565C0' },
  startIcon: { fontSize: 16, color: '#fff' },
  startText: { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: 0.2 },

  // ── Search modal ──
  searchModal: { flex: 1, backgroundColor: '#fff' },
  searchHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  searchInputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f5f5f5', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 8,
  },
  searchInputIcon: { fontSize: 16 },
  searchInput: { flex: 1, fontSize: 16, color: '#111' },
  cancelBtn: { paddingHorizontal: 4, paddingVertical: 8 },
  cancelText: { fontSize: 16, color: '#1565C0', fontWeight: '600' },
  useCurrentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 16 },
  useCurrentIcon: { fontSize: 20 },
  useCurrentLabel: { fontSize: 15, fontWeight: '600', color: '#2e7d32' },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
  suggestionIcon: { fontSize: 18, width: 24 },
  suggestionInfo: { flex: 1 },
  suggestionMain: { fontSize: 15, fontWeight: '600', color: '#111' },
  suggestionSub: { fontSize: 12, color: '#888', marginTop: 2 },
  suggestionDivider: { height: 1, backgroundColor: '#f5f5f5', marginLeft: 56 },
});
