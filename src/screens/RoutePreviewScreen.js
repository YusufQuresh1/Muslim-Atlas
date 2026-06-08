import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  StatusBar,
  ScrollView,
  Linking,
  ActivityIndicator,
  Platform,
} from 'react-native';
// SafeAreaView from react-native (react-native-safe-area-context not installed)
import { SafeAreaView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import MapView, { Polyline, Marker } from 'react-native-maps';

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters) {
  if (!meters) return '—';
  const miles = meters * 0.000621371;
  return miles >= 0.1 ? `${miles.toFixed(1)} mi` : `${Math.round(meters * 3.28084)} ft`;
}

function estimateMinutes(distanceM, mode) {
  const roadFactor = mode === 'walking' ? 1.2 : 1.35;
  const effectiveDist = distanceM * roadFactor;
  const speedMperMin = { walking: 83, 'driving-traffic': 500, transit: 267 };
  const waitMin = mode === 'transit' ? 4 : 0;
  return Math.max(1, Math.round(effectiveDist / speedMperMin[mode] + waitMin));
}

// Decode Google's encoded polyline format
function decodePolyline(encoded) {
  if (!encoded) return [];
  let index = 0, lat = 0, lng = 0;
  const coords = [];
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return coords;
}

// Map Google vehicle type to emoji
function vehicleIcon(type) {
  const map = {
    BUS: '🚌', SUBWAY: '🚇', TRAIN: '🚆', TRAM: '🚊',
    FERRY: '⛴️', RAIL: '🚆', CABLE_CAR: '🚡',
    GONDOLA_LIFT: '🚡', FUNICULAR: '🚡',
  };
  return map[type] ?? '🚍';
}

// Parse Directions API step array into a compact chain of "segments"
function buildTransitChain(steps) {
  return steps
    .map((step) => {
      if (step.travel_mode === 'WALKING') {
        return { type: 'walk', icon: '🚶', label: step.duration?.text ?? '' };
      }
      if (step.travel_mode === 'TRANSIT') {
        const td = step.transit_details;
        const vType = td?.line?.vehicle?.type ?? 'BUS';
        const lineName = td?.line?.short_name ?? td?.line?.name ?? '';
        const stops = td?.num_stops;
        return {
          type: 'transit',
          icon: vehicleIcon(vType),
          label: lineName,
          stops: stops ? `${stops} stop${stops > 1 ? 's' : ''}` : '',
        };
      }
      return null;
    })
    .filter(Boolean);
}

// Compute bounding region for a set of coords (for the mini-map)
function boundingRegion(coords, originCoord, destCoord) {
  const all = [...coords, originCoord, destCoord];
  const lats = all.map((c) => c.latitude);
  const lngs = all.map((c) => c.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const pad = 0.15;
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: (maxLat - minLat) * (1 + pad) + 0.005,
    longitudeDelta: (maxLng - minLng) * (1 + pad) + 0.005,
  };
}

// ─── Transport Mode Config ────────────────────────────────────────────────────

const MODES = [
  { key: 'driving-traffic', label: 'Drive',   icon: '🚗', mapboxProfile: 'driving-traffic' },
  { key: 'walking',         label: 'Walk',    icon: '🚶', mapboxProfile: 'walking'          },
  { key: 'transit',         label: 'Transit', icon: '🚇', mapboxProfile: null               },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function RoutePreviewScreen({ mosque, userLocation, onBack, onStart }) {
  const { theme, isDark } = useTheme();
  const [selectedMode, setSelectedMode] = useState(null);

  // Transit data
  const [transitLoading, setTransitLoading] = useState(false);
  const [transitData, setTransitData] = useState(null);   // first route from Directions API
  const [transitChain, setTransitChain] = useState([]);   // parsed step chain
  const [polylineCoords, setPolylineCoords] = useState([]);
  const [transitDurationText, setTransitDurationText] = useState(null);

  const [startLabel, setStartLabel] = useState('Your Location');

  // ── Derived values ───────────────────────────────────────────────────────
  const distance = useMemo(() => {
    if (!mosque || !userLocation) return null;
    return haversineDistance(
      userLocation.coords.latitude, userLocation.coords.longitude,
      mosque.location.latitude, mosque.location.longitude,
    );
  }, [mosque, userLocation]);

  const estimatedTimes = useMemo(() => {
    if (!distance) return {};
    return {
      'driving-traffic': estimateMinutes(distance, 'driving-traffic'),
      walking: estimateMinutes(distance, 'walking'),
      transit: estimateMinutes(distance, 'transit'),
    };
  }, [distance]);

  const quickestMode = useMemo(() => {
    if (!estimatedTimes || Object.keys(estimatedTimes).length === 0) return 'driving-traffic';
    return Object.entries(estimatedTimes).reduce(
      (best, [mode, t]) => (t < estimatedTimes[best] ? mode : best),
      'driving-traffic',
    );
  }, [estimatedTimes]);

  const activeMode = selectedMode ?? quickestMode;
  const activeModeConfig = MODES.find((m) => m.key === activeMode);

  // Active duration: use real API data for transit, estimates otherwise
  const activeMinutes = activeMode === 'transit' && transitData
    ? null   // we'll show transitDurationText instead
    : estimatedTimes[activeMode];

  const originCoord = {
    latitude: userLocation?.coords?.latitude,
    longitude: userLocation?.coords?.longitude,
  };
  const destCoord = {
    latitude: mosque?.location?.latitude,
    longitude: mosque?.location?.longitude,
  };

  // ── Fetch Google Directions (Transit) ────────────────────────────────────
  useEffect(() => {
    if (activeMode !== 'transit') return;

    setTransitLoading(true);
    setTransitData(null);
    setTransitChain([]);
    setPolylineCoords([]);
    setTransitDurationText(null);

    (async () => {
      try {
        const url = [
          'https://maps.googleapis.com/maps/api/directions/json',
          `?origin=${originCoord.latitude},${originCoord.longitude}`,
          `&destination=${destCoord.latitude},${destCoord.longitude}`,
          `&mode=transit`,
          `&alternatives=true`,
          `&key=${GOOGLE_PLACES_API_KEY}`,
        ].join('');

        const res = await fetch(url);
        const data = await res.json();

        if (data.status !== 'OK' || !data.routes?.length) {
          console.warn('Directions API:', data.status, data.error_message);
          setTransitLoading(false);
          return;
        }

        const route = data.routes[0];
        const leg = route.legs[0];

        setTransitData(leg);
        setTransitDurationText(leg.duration?.text ?? null);
        setTransitChain(buildTransitChain(leg.steps, '#1565C0', 16));

        const decoded = decodePolyline(route.overview_polyline?.points);
        setPolylineCoords(decoded);
      } catch (err) {
        console.error('Transit directions error:', err);
      } finally {
        setTransitLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode]);

  // ── Mini-map region — null-safe: only compute when both coords have valid values
  const miniMapRegion = useMemo(() => {
    if (
      !originCoord.latitude || !originCoord.longitude ||
      !destCoord.latitude || !destCoord.longitude
    ) return null;
    if (polylineCoords.length < 2) {
      return boundingRegion([], originCoord, destCoord);
    }
    return boundingRegion(polylineCoords, originCoord, destCoord);
  }, [polylineCoords, originCoord, destCoord]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleEditStart = useCallback(() => {
    Alert.alert(
      'Change Start Location',
      'Enter a start address to begin from a different location.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Use My Location', onPress: () => setStartLabel('Your Location') },
      ],
    );
  }, []);

  const handleStart = useCallback(() => {
    if (activeMode === 'transit') {
      // Open native Google Maps with transit routing
      const { latitude: dLat, longitude: dLng } = destCoord;
      const { latitude: oLat, longitude: oLng } = originCoord;

      // Universal URL — opens Google Maps app if installed, browser otherwise
      const universalUrl =
        `https://www.google.com/maps/dir/?api=1` +
        `&origin=${oLat},${oLng}` +
        `&destination=${dLat},${dLng}` +
        `&travelmode=transit` +
        `&dir_action=navigate`;

      // Android deep-link (faster, opens inline navigation)
      const androidUrl = `google.navigation:q=${dLat},${dLng}&mode=t`;

      const urlToOpen = Platform.OS === 'android' ? androidUrl : universalUrl;

      Linking.canOpenURL(urlToOpen)
        .then((supported) => {
          if (supported) return Linking.openURL(urlToOpen);
          // Fallback to universal URL if the native scheme isn't available
          return Linking.openURL(universalUrl);
        })
        .catch(() => Linking.openURL(universalUrl));

      return; // Do NOT call onStart — no Mapbox needed
    }

    // Drive / Walk — hand off to Mapbox NavigationScreen
    onStart({
      transportMode: activeMode,
      routeProfile: activeModeConfig?.mapboxProfile ?? 'driving-traffic',
      startLabel,
    });
  }, [activeMode, activeModeConfig, destCoord, originCoord, onStart, startLabel]);

  if (!mosque || !userLocation) return null;

  // Arrival time estimate
  const arrivalTime = (() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + (activeMinutes ?? 0));
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  })();

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Route Preview</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Destination Card ── */}
        <View style={styles.destinationCard}>
          <View style={styles.pinLine}>
            <MaterialCommunityIcons name="mosque" size={28} color={theme.primary} />
            <View style={styles.pinInfo}>
              <Text style={styles.destName} numberOfLines={1}>
                {mosque.displayName.text}
              </Text>
              <Text style={styles.destAddress} numberOfLines={2}>
                {mosque.formattedAddress}
              </Text>
            </View>
            <View style={styles.distBadge}>
              <Text style={styles.distBadgeText}>{formatDistance(distance)}</Text>
            </View>
          </View>
        </View>

        {/* ── Mode Selector ── */}
        <View style={styles.modeSection}>
          <Text style={styles.sectionLabel}>HOW ARE YOU GETTING THERE?</Text>
          <View style={styles.modeRow}>
            {MODES.map((mode) => {
              const isActive = mode.key === activeMode;
              const mins = estimatedTimes[mode.key];
              // For transit, show real duration if we have it
              const displayTime =
                mode.key === 'transit' && transitDurationText
                  ? transitDurationText
                  : mins
                  ? `${mins} min`
                  : '—';
              return (
                <TouchableOpacity
                  key={mode.key}
                  style={[styles.modeCard, isActive && styles.modeCardActive]}
                  onPress={() => setSelectedMode(mode.key)}
                  activeOpacity={0.75}
                >
                  <Ionicons name={mode.iconName} size={26} color={isActive ? '#2e7d32' : '#555'} style={styles.modeIcon} />
                  <Text style={[styles.modeLabel, isActive && styles.modeLabelActive]}>
                    {mode.label}
                  </Text>
                  {mode.key === 'transit' && transitLoading && isActive ? (
                    <ActivityIndicator size="small" color="#2e7d32" style={{ marginTop: 2 }} />
                  ) : (
                    <Text style={[styles.modeTime, isActive && styles.modeTimeActive]}>
                      {displayTime}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Transit: Mini-map + Step Chain ── */}
        {activeMode === 'transit' && (
          <>
            {/* Mini route map */}
            <View style={styles.miniMapCard}>
              {miniMapRegion ? (
                <MapView
                  style={styles.miniMap}
                  region={miniMapRegion}
                  scrollEnabled={false}
                  zoomEnabled={false}
                  pitchEnabled={false}
                  rotateEnabled={false}
                  customMapStyle={[{ featureType: 'poi', stylers: [{ visibility: 'off' }] }]}
                >
                  {polylineCoords.length > 0 && (
                    <Polyline
                      coordinates={polylineCoords}
                      strokeColor="#1565C0"
                      strokeWidth={4}
                      lineDashPattern={[8, 4]}
                    />
                  )}
                  <Marker coordinate={originCoord} pinColor="blue" />
                  <Marker coordinate={destCoord} pinColor="red" />
                </MapView>
              ) : (
                <View style={[styles.miniMap, { backgroundColor: '#e8eaf6', justifyContent: 'center', alignItems: 'center' }]}>
                  <ActivityIndicator color="#1565C0" />
                </View>
              )}
              {transitLoading && (
                <View style={styles.mapLoadingOverlay}>
                  <ActivityIndicator size="large" color="#1565C0" />
                  <Text style={styles.mapLoadingText}>Fetching transit route…</Text>
                </View>
              )}
            </View>

            {/* Transit step chain */}
            {!transitLoading && transitChain.length > 0 && (
              <View style={styles.stepChainCard}>
                <Text style={styles.sectionLabel}>ROUTE BREAKDOWN</Text>
                <View style={styles.stepChain}>
                  {transitChain.map((seg, idx) => (
                    <React.Fragment key={idx}>
                      <View style={styles.stepChip}>
                        <View style={styles.stepChipIcon}>{seg.icon}</View>
                        {seg.label ? (
                          <Text style={styles.stepChipLabel}>{seg.label}</Text>
                        ) : null}
                        {seg.stops ? (
                          <Text style={styles.stepChipSub}>{seg.stops}</Text>
                        ) : (
                          <Text style={styles.stepChipSub}>{seg.label || 'Walk'}</Text>
                        )}
                      </View>
                      {idx < transitChain.length - 1 && (
                        <Ionicons name="chevron-forward" size={16} color="#90CAF9" style={styles.stepArrow} />
                      )}
                    </React.Fragment>
                  ))}
                </View>
                {transitDurationText && (
                  <View style={styles.transitTimeBadge}>
                    <Text style={styles.transitTimeBadgeText}>
                      <Ionicons name="time-outline" size={14} color="#2e7d32" /> {transitDurationText} total
                    </Text>
                  </View>
                )}

                {/* Note about Google Maps handoff */}
                <View style={styles.transitNote}>
                  <Text style={styles.transitNoteText}>
                    <Ionicons name="map-outline" size={14} color="#795548" /> Tapping "Start" will open Google Maps for live transit navigation.
                  </Text>
                </View>
              </View>
            )}
          </>
        )}

        {/* ── Journey Summary (Drive / Walk) ── */}
        {activeMode !== 'transit' && (
          <View style={styles.summaryCard}>
            <Text style={styles.sectionLabel}>JOURNEY SUMMARY</Text>

            {/* From */}
            <TouchableOpacity style={styles.routeRow} onPress={handleEditStart} activeOpacity={0.7}>
              <View style={styles.routeDot} />
              <View style={styles.routeRowContent}>
                <Text style={styles.routeRowLabel}>From</Text>
                <Text style={styles.routeRowValue}>{startLabel}</Text>
              </View>
              <Text style={styles.editHint}>Edit ›</Text>
            </TouchableOpacity>

            <View style={styles.routeConnector} />

            {/* To */}
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, styles.routeDotDest]} />
              <View style={styles.routeRowContent}>
                <Text style={styles.routeRowLabel}>To</Text>
                <Text style={styles.routeRowValue} numberOfLines={1}>
                  {mosque.displayName.text}
                </Text>
              </View>
            </View>

            {/* Stats */}
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statVal}>{formatDistance(distance)}</Text>
                <Text style={styles.statLbl}>Distance</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statVal}>
                  {activeModeConfig?.icon} {activeMinutes} min
                </Text>
                <Text style={styles.statLbl}>{activeModeConfig?.label}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statVal}>{arrivalTime}</Text>
                <Text style={styles.statLbl}>Arrival</Text>
              </View>
            </View>
          </View>
        )}

        {/* Bottom padding so footer doesn't overlap */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── Start Button ── */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.startBtn,
            activeMode === 'transit' && styles.startBtnTransit,
          ]}
          onPress={handleStart}
          activeOpacity={0.85}
          disabled={activeMode === 'transit' && transitLoading}
        >
          <Text style={styles.startIcon}>
            {activeMode === 'transit' ? '🗺️' : '▶'}
          </Text>
          <Text style={styles.startText}>
            {activeMode === 'transit' ? 'Open in Google Maps' : 'Start Navigation'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f6f9' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#f2f2f2',
    alignItems: 'center', justifyContent: 'center',
  },
  backIcon: { fontSize: 20, color: '#111', fontWeight: 'bold' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111' },

  // Destination card
  destinationCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 16,
    borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 3,
  },
  pinLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pinDot: { fontSize: 28 },
  pinInfo: { flex: 1 },
  destName: { fontSize: 17, fontWeight: '700', color: '#111' },
  destAddress: { fontSize: 13, color: '#888', marginTop: 2, lineHeight: 18 },
  distBadge: { backgroundColor: '#e8f5e9', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  distBadgeText: { fontSize: 13, fontWeight: '700', color: '#2e7d32' },

  // Mode selector
  modeSection: { marginHorizontal: 16, marginTop: 20 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: '#aaa',
    letterSpacing: 0.8, marginBottom: 10,
  },
  modeRow: { flexDirection: 'row', gap: 10 },
  modeCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 14,
    alignItems: 'center', paddingVertical: 14, paddingHorizontal: 4,
    borderWidth: 2, borderColor: 'transparent',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  modeCardActive: { borderColor: '#2e7d32', backgroundColor: '#f0faf0' },
  modeIcon: { fontSize: 26, marginBottom: 4 },
  modeLabel: { fontSize: 12, fontWeight: '600', color: '#555', marginBottom: 2 },
  modeLabelActive: { color: '#2e7d32' },
  modeTime: { fontSize: 15, fontWeight: '800', color: '#222' },
  modeTimeActive: { color: '#1b5e20' },

  // Mini map
  miniMapCard: {
    marginHorizontal: 16, marginTop: 16,
    borderRadius: 16, overflow: 'hidden',
    height: 200,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 6, elevation: 4,
  },
  miniMap: { flex: 1 },
  mapLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  mapLoadingText: { fontSize: 14, color: '#555' },

  // Transit step chain
  stepChainCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 12,
    borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 3,
  },
  stepChain: {
    flexDirection: 'row', flexWrap: 'wrap',
    alignItems: 'center', gap: 4, marginBottom: 12,
  },
  stepChip: {
    backgroundColor: '#e3f2fd', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 6,
    alignItems: 'center',
    flexDirection: 'row', gap: 4,
  },
  stepChipIcon: { fontSize: 16 },
  stepChipLabel: { fontSize: 13, fontWeight: '700', color: '#1565C0' },
  stepChipSub: { fontSize: 11, color: '#1976D2' },
  stepArrow: { fontSize: 18, color: '#90CAF9', fontWeight: 'bold' },
  transitTimeBadge: {
    backgroundColor: '#e8f5e9', borderRadius: 20, alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 6, marginBottom: 12,
  },
  transitTimeBadgeText: { fontSize: 14, fontWeight: '700', color: '#2e7d32' },
  transitNote: {
    backgroundColor: '#fff8e1', borderRadius: 10,
    padding: 10,
  },
  transitNoteText: { fontSize: 12, color: '#795548', lineHeight: 18 },

  // Journey summary (drive/walk)
  summaryCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 16,
    borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 3,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  routeDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#4A90E2', marginLeft: 2 },
  routeDotDest: { backgroundColor: '#2e7d32' },
  routeRowContent: { flex: 1 },
  routeRowLabel: { fontSize: 11, color: '#aaa', fontWeight: '600', letterSpacing: 0.3 },
  routeRowValue: { fontSize: 15, color: '#111', fontWeight: '600', marginTop: 1 },
  editHint: { fontSize: 13, color: '#4A90E2', fontWeight: '600' },
  routeConnector: {
    width: 2, height: 18, backgroundColor: '#e0e0e0', marginLeft: 7, marginVertical: 2,
  },
  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 16, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: '#f0f0f0',
  },
  stat: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: 15, fontWeight: '800', color: '#111' },
  statLbl: { fontSize: 11, color: '#aaa', marginTop: 2, fontWeight: '600', letterSpacing: 0.3 },
  statDivider: { width: 1, height: 32, backgroundColor: '#eee' },

  // Footer
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12,
    backgroundColor: '#f4f6f9',
  },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#2e7d32', borderRadius: 18,
    paddingVertical: 18, gap: 10,
    shadowColor: '#2e7d32', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 8,
  },
  startBtnTransit: {
    backgroundColor: '#1565C0',
    shadowColor: '#1565C0',
  },
  startIcon: { fontSize: 18, color: '#fff' },
  startText: { fontSize: 19, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
});
