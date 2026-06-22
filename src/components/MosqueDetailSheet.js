import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MosqueContext } from '../context/MosqueContext';
import { useTheme } from '../context/ThemeContext';
import MosqueExtendedInfoModal from './MosqueExtendedInfoModal';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;


// ─── Time diff formatter ───────────────────────────────────────────────────
function formatTimeDiff(totalMins) {
  if (totalMins < 60) return `${totalMins} min`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

// ─── Haversine distance (meters) ─────────────────────────────────────
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
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

const MosqueDetailSheet = React.forwardRef(
  ({ 
    mosque, 
    userLocation, 
    mosques, 
    setSelectedMosque, 
    activeCategory = 'mosque',
    setActiveCategory,
    onClose, 
    onStartNavigating, 
    onShowOnMap,
    onChange, 
    estimatedTimes, 
    nextPrayer, 
    mosquePrayerTimes, 
    mosquePrayerLoading,
    setViewMode,
  }, ref) => {
    const snapPoints = useMemo(() => ['25%', '60%', '90%', '100%'], []);
    const insets = useSafeAreaInsets();
    const { fetchPlaceDeepData, fetchPlaceFromFirebase, getCrowdsourcedData, setSearchOrigin, setSearchLocationName, searchArea } = useContext(MosqueContext);
    const { theme } = useTheme();

    // State
    const [nearbyTransit, setNearbyTransit] = useState([]);
    const [photoUri, setPhotoUri] = useState(null);
    const [details, setDetails] = useState(null);
    const [hoursExpanded, setHoursExpanded] = useState(false);
    const [halalPlaces, setHalalPlaces] = useState([]);
    const [deepLoading, setDeepLoading] = useState(false);
    const [infoModalVisible, setInfoModalVisible] = useState(false);

    const crowdsourcedData = useMemo(() => {
      if (!mosque?.id) return null;
      return getCrowdsourcedData(mosque.id);
    }, [mosque?.id, getCrowdsourcedData]);

    useEffect(() => {
      if (mosque?.id) {
        fetchPlaceFromFirebase(mosque.id);
      }
    }, [mosque?.id, fetchPlaceFromFirebase]);

    // ── Computed values ──
    const distance = useMemo(() => {
      if (!mosque || !userLocation) return null;
      return haversineDistance(
        userLocation.coords.latitude,
        userLocation.coords.longitude,
        mosque.location.latitude,
        mosque.location.longitude,
      );
    }, [mosque?.location?.latitude, mosque?.location?.longitude, userLocation]);

    // ── Deep Cache: Single fetch for Details + Transit + Halal Food ──
    useEffect(() => {
      if (!mosque) {
        setDetails(null);
        setNearbyTransit([]);
        setHalalPlaces([]);
        setHoursExpanded(false);
        return;
      }
      setDeepLoading(true);
      setHoursExpanded(false);
      fetchPlaceDeepData(mosque, activeCategory).then((deepData) => {
        if (deepData) {
          setDetails(deepData.details ?? null);
          const sortedTransit = [...(deepData.transit ?? [])].sort((a, b) => (a.distance || 0) - (b.distance || 0));
          setNearbyTransit(sortedTransit);
          // Use 'food' field when viewing a mosque, 'nearbyMosques' when viewing food
          setHalalPlaces(activeCategory === 'mosque' ? (deepData.food ?? []) : (deepData.nearbyMosques ?? []));
        }
        setDeepLoading(false);
      });
    }, [mosque?.id, activeCategory, fetchPlaceDeepData]);

    // ── Fetch mosque photo (from object, no API call needed) ──
    useEffect(() => {
      if (!mosque?.photos?.length) { 
        setPhotoUri(null); 
        return; 
      }
      setPhotoUri(
        `https://places.googleapis.com/v1/${mosque.photos[0].name}/media?maxWidthPx=400&key=${GOOGLE_PLACES_API_KEY}`,
      );
    }, [mosque?.id]);

    // ── Handlers ──
    const handleNavigate = useCallback(() => {
      if (onStartNavigating) onStartNavigating();
    }, [onStartNavigating]);

    const handleInfo = useCallback(() => {
      setInfoModalVisible(true);
    }, []);

    const handleWebsite = useCallback(() => {
      if (!details?.websiteUri) {
        Alert.alert('No Website', 'No website available for this mosque.');
        return;
      }
      Linking.openURL(details.websiteUri);
    }, [details]);



    const handleSheetChange = useCallback((index) => {
      if (onChange) onChange(index);
    }, [onChange]);

    // ── Pagination Handlers ──
    const currentIndex = useMemo(() => {
      if (!mosques || !mosque) return -1;
      return mosques.findIndex(m => m.id === mosque.id);
    }, [mosques, mosque]);

    const handlePrev = useCallback(() => {
      if (currentIndex > 0 && setSelectedMosque) {
        setSelectedMosque(mosques[currentIndex - 1]);
      }
    }, [currentIndex, mosques, setSelectedMosque]);

    const handleNext = useCallback(() => {
      if (mosques && currentIndex < mosques.length - 1 && setSelectedMosque) {
        setSelectedMosque(mosques[currentIndex + 1]);
      }
    }, [currentIndex, mosques, setSelectedMosque]);


    // Opening hours helpers
    const isOpenNow = details?.regularOpeningHours?.openNow;
    const weekdayText = details?.regularOpeningHours?.weekdayDescriptions;

    // ── Pre-compute Countdown ──
    const minsUntilPrayer = useMemo(() => {
      if (!nextPrayer || !nextPrayer.timeObj) return null;
      return Math.round((nextPrayer.timeObj.getTime() - Date.now()) / 60000);
    }, [nextPrayer]);

    // ── Pre-compute Active Prayer ──
    const activePrayerName = useMemo(() => {
      if (!nextPrayer || !nextPrayer.name) return null;
      const PRAYERS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
      const nextIdx = PRAYERS.indexOf(nextPrayer.name);
      if (nextIdx === -1) return null;
      const activeIdx = (nextIdx - 1 + PRAYERS.length) % PRAYERS.length;
      return PRAYERS[activeIdx];
    }, [nextPrayer]);

    const isMosqueCTA = activeCategory === 'mosque';
    const ctaBgColor = isMosqueCTA ? '#B5651D' : '#059669';
    const ctaBorderColor = isMosqueCTA ? '#9E5414' : '#047857';
    const ctaColor = '#ffffff';

    // Always render BottomSheet so the ref is valid before mosque is selected.
    // The ref would be null if we do early return null, making snapToIndex fail.
    return (
      <BottomSheet
        ref={ref}
        index={-1}
        snapPoints={snapPoints}
        topInset={insets.top}
        onChange={handleSheetChange}
        enablePanDownToClose={true}
        backgroundStyle={[styles.sheetBackground, { backgroundColor: theme.card }]}
        handleIndicatorStyle={[styles.handleIndicator, { backgroundColor: theme.border }]}
      >
        <BottomSheetScrollView contentContainerStyle={styles.contentContainer}>
          {mosque ? (<>
          {/* ── Header ── */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={[styles.mosqueName, { color: theme.text }]} numberOfLines={2}>
                {mosque.displayName.text}
              </Text>
              
              <View style={styles.ratingRow}>
                {mosque.rating && (
                  <>
                    <Ionicons name="star" size={14} color="#fbc02d" />
                    <Text style={[styles.ratingText, { color: theme.text }]}>
                      {mosque.rating.toFixed(1)}
                    </Text>
                  </>
                )}
                {mosque.userRatingCount && (
                  <Text style={[styles.ratingCount, { color: theme.subText }]}>
                    ({mosque.userRatingCount} reviews)
                  </Text>
                )}
                {isOpenNow !== undefined && (
                  <View
                    style={[
                      styles.statusBadge,
                      isOpenNow 
                        ? { backgroundColor: theme.mode === 'dark' ? 'rgba(74, 222, 128, 0.2)' : '#e8f5e9' } 
                        : { backgroundColor: theme.mode === 'dark' ? 'rgba(239, 68, 68, 0.2)' : '#fce4ec' },
                      { marginLeft: 8, paddingVertical: 2, paddingHorizontal: 8 }
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusText,
                        isOpenNow 
                          ? { color: theme.mode === 'dark' ? '#4ade80' : '#2e7d32' } 
                          : { color: theme.mode === 'dark' ? '#f87171' : '#c62828' },
                      ]}
                    >
                      {isOpenNow ? 'Open Now' : 'Closed'}
                    </Text>
                  </View>
                )}
              </View>
            </View>
            <View style={styles.headerRight}>
              <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: theme.chipBg }]}>
                <Text style={[styles.closeBtnText, { color: theme.text }]}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Address (under name) ── */}
          <Text style={[styles.addressText, { color: theme.subText }]}>
            <Ionicons name="location-sharp" size={14} color="#6366F1" /> {formatDistance(distance)} • {mosque.formattedAddress}
          </Text>
 
          {/* ── Quick Amenities Row ── */}
          {activeCategory === 'mosque' && crowdsourcedData && (
            <View style={styles.quickAmenitiesRow}>
              {crowdsourcedData.hasWomens && (
                <View style={[styles.amenityChip, { backgroundColor: theme.chipBg }]}>
                  <MaterialCommunityIcons name="human-female" size={16} color={theme.chipText} />
                  <Text style={[styles.amenityChipText, { color: theme.chipText }]}>Women's</Text>
                </View>
              )}
              {crowdsourcedData.wheelchair && (
                <View style={[styles.amenityChip, { backgroundColor: theme.chipBg }]}>
                  <MaterialCommunityIcons name="wheelchair-accessibility" size={16} color={theme.chipText} />
                  <Text style={[styles.amenityChipText, { color: theme.chipText }]}>Access</Text>
                </View>
              )}
              {crowdsourcedData.wudu && (
                <View style={[styles.amenityChip, { backgroundColor: theme.chipBg }]}>
                  <MaterialCommunityIcons name="water" size={16} color={theme.chipText} />
                  <Text style={[styles.amenityChipText, { color: theme.chipText }]}>Wudu</Text>
                </View>
              )}
            </View>
          )}
 
          {/* ── Photo & Prayer Times Overlay ── */}
          <View style={styles.photoWrapper}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.photo} />
            ) : (
              <View style={[
                styles.photoPlaceholder, 
                { backgroundColor: theme.chipBg },
                activeCategory === 'food' && { backgroundColor: theme.mode === 'dark' ? '#431407' : '#FFEDD5' }
              ]}>
                {activeCategory === 'food' ? (
                  <MaterialCommunityIcons name="silverware-fork-knife" size={48} color={theme.mode === 'dark' ? '#fb923c' : '#EA580C'} />
                ) : (
                  <MaterialCommunityIcons name="mosque" size={48} color="#0D9488" />
                )}
              </View>
            )}
 
            {/* Translucent Prayer Overlay fixed to bottom of image */}
            {activeCategory === 'mosque' && (
              <View style={styles.prayerOverlay}>
                {mosquePrayerLoading ? (
                <ActivityIndicator size="small" color="#fff" style={{ paddingVertical: 10 }} />
              ) : mosquePrayerTimes ? (
                <>
                  <View style={styles.prayerOverlayHeader}>
                    <Text style={styles.prayerOverlayApproxText}>* Approximate start times</Text>
                  </View>
                  <View style={styles.prayerOverlayRow}>
                    {['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map((name) => {
                      const isActive = name === activePrayerName;
                      return (
                        <View key={name} style={[styles.prayerCol, isActive && styles.prayerColActive]}>
                          <Text style={[styles.prayerOverlayName, isActive && styles.prayerOverlayNameActive]}>{name}</Text>
                          <Text style={[styles.prayerOverlayTime, isActive && styles.prayerOverlayTimeActive]}>
                            {mosquePrayerTimes[name]?.split(' ')[0]}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </>
              ) : null}
            </View>
            )}
          </View>
 
          {/* ── Next Prayer Notice ── */}
          {activeCategory === 'mosque' && nextPrayer && minsUntilPrayer !== null && (
            <Text style={[styles.nextPrayerNotice, { color: theme.primary }]}>
              {nextPrayer.name} in {formatTimeDiff(minsUntilPrayer)}
            </Text>
          )}
 
          {/* ── Live Stats ── */}
          <View style={[styles.statsRow, { backgroundColor: theme.background }]}>
            <View style={styles.statBox}>
              <Ionicons name="car-outline" size={18} color="#3B82F6" style={{ marginRight: 6 }} />
              <Text style={[styles.statValue, { color: theme.text }]}>
                {estimatedTimes?.['driving-traffic'] ? `${estimatedTimes['driving-traffic']} min` : '—'}
              </Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
            <View style={styles.statBox}>
              <Ionicons name="walk-outline" size={18} color="#F97316" style={{ marginRight: 6 }} />
              <Text style={[styles.statValue, { color: theme.text }]}>
                {estimatedTimes?.walking ? `${estimatedTimes.walking} min` : '—'}
              </Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
            <View style={styles.statBox}>
              <Ionicons name="subway-outline" size={18} color="#8B5CF6" style={{ marginRight: 6 }} />
              <Text style={[styles.statValue, { color: theme.text }]}>
                {estimatedTimes?.transit ? `${estimatedTimes.transit} min` : '—'}
              </Text>
            </View>
          </View>
 
          {/* ── Action Buttons ── */}
          <View style={styles.actionBar}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: theme.background }]}
              onPress={handleInfo}
              activeOpacity={0.7}
            >
              <Ionicons name="information-circle-outline" size={24} color="#0284C7" style={{ marginBottom: 4 }} />
              <Text style={[styles.actionLabel, { color: theme.text }]}>Info</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: theme.background }]}
              onPress={handleWebsite}
              activeOpacity={0.7}
            >
              <Ionicons name="globe-outline" size={24} color="#2563EB" style={{ marginBottom: 4 }} />
              <Text style={[styles.actionLabel, { color: theme.text }]}>Website</Text>
            </TouchableOpacity>
            {onShowOnMap && (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: theme.background }]}
                onPress={onShowOnMap}
                activeOpacity={0.7}
              >
                <Ionicons name="location-outline" size={24} color="#F43F5E" style={{ marginBottom: 4 }} />
                <Text style={[styles.actionLabel, { color: theme.text }]}>Map</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.actionBtn, styles.navBtn, { backgroundColor: theme.primary }]}
              onPress={handleNavigate}
              activeOpacity={0.7}
            >
              <Ionicons name="navigate-outline" size={24} color="#fff" style={{ marginBottom: 4 }} />
              <Text style={[styles.actionLabel, styles.navLabel]}>
                Directions
              </Text>
            </TouchableOpacity>
          </View>
 
          {/* ── Opening Hours ── */}
          {(deepLoading || weekdayText) && (
            <View style={[styles.card, { backgroundColor: theme.card }]}>
              <View style={styles.cardHeader}>
                <Ionicons name="time-outline" size={20} color="#F59E0B" style={{ marginRight: 6 }} />
                <Text style={[styles.cardTitle, { color: theme.text }]}>Opening Hours</Text>
                {deepLoading && (
                  <ActivityIndicator size="small" color={theme.primary} />
                )}
              </View>
              {weekdayText && (
                <>
                  <TouchableOpacity
                    onPress={() => setHoursExpanded(!hoursExpanded)}
                    style={styles.hoursToggle}
                  >
                    <Text style={[styles.hoursToggleText, { color: theme.text }]}>
                      {hoursExpanded ? 'Hide hours ▲' : 'Show full hours ▼'}
                    </Text>
                  </TouchableOpacity>
                  {hoursExpanded &&
                    weekdayText.map((line, idx) => (
                      <Text key={idx} style={[styles.hourLine, { color: theme.text }]}>
                        {line}
                      </Text>
                    ))}
                </>
              )}
            </View>
          )}
 
          {/* ── Nearby Transport ── */}
          {(deepLoading || nearbyTransit.length > 0) && (
            <View style={[styles.card, { backgroundColor: theme.card }]}>
              <View style={styles.cardHeader}>
                <Ionicons name="subway-outline" size={20} color="#8B5CF6" style={{ marginRight: 6 }} />
                <Text style={[styles.cardTitle, { color: theme.text }]}>Nearby Transport</Text>
                {deepLoading && (
                  <ActivityIndicator size="small" color={theme.primary} />
                )}
              </View>
              {nearbyTransit.length > 0 &&
                nearbyTransit.map((station, idx) => (
                  <View key={idx} style={[styles.transitRow, { borderBottomColor: theme.border }]}>
                    <Text style={[styles.transitName, { color: theme.text }]}>{station.name}</Text>
                    <Text style={[styles.transitDist, { color: theme.subText }]}>{station.distance} m</Text>
                  </View>
                ))
              }
            </View>
          )}

          {/* ── Cross-Pollination CTA (Open List View) ── */}
          <View style={[styles.sectionDivider, { backgroundColor: theme.border }]} />
          <TouchableOpacity 
            style={[
              styles.crossNavigateBtn, 
              { 
                backgroundColor: ctaBgColor, 
                borderColor: ctaBorderColor
              }
            ]}
            activeOpacity={0.8}
            onPress={async () => {
              if (!mosque) return;
              const targetCategory = activeCategory === 'mosque' ? 'food' : 'mosque';
              const newOrigin = { coords: { latitude: mosque.location.latitude, longitude: mosque.location.longitude } };
              
              setSearchOrigin(newOrigin);
              setSearchLocationName(mosque.displayName?.text || mosque.name || 'Location');
              setActiveCategory(targetCategory);
              
              if (onClose) onClose();
              if (setViewMode) setViewMode('list');
              
              // Only trigger the deep search on button tap!
              await searchArea(newOrigin.coords.latitude, newOrigin.coords.longitude, 5000, newOrigin, 20, true);
            }}
          >
            <View style={styles.crossNavigateContent}>
              {activeCategory === 'mosque' ? (
                <MaterialCommunityIcons name="silverware-fork-knife" size={24} color={ctaColor} style={{ marginRight: 8 }} />
              ) : (
                <MaterialCommunityIcons name="mosque" size={24} color={ctaColor} style={{ marginRight: 8 }} />
              )}
              <Text style={[styles.crossNavigateText, { color: ctaColor }]}>
                {activeCategory === 'mosque' ? 'Find Halal Food Nearby' : 'Find Nearby Mosques'}
              </Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color={ctaColor} />
          </TouchableOpacity>
          </>
          ) : null}
        </BottomSheetScrollView>

        <MosqueExtendedInfoModal
          visible={infoModalVisible}
          onClose={() => setInfoModalVisible(false)}
          mosque={mosque}
          crowdsourcedData={crowdsourcedData}
        />
      </BottomSheet>
    );
  },
);

export default MosqueDetailSheet;

// ─── Styles ──────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 12,
  },
  handleIndicator: {
    backgroundColor: '#d0d0d0',
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  addressText: {
    fontSize: 13,
    color: '#777',
    marginBottom: 8,
    lineHeight: 18,
  },
  quickAmenitiesRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  amenityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 4,
  },
  amenityChipIcon: {
    fontSize: 14,
  },
  amenityChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  headerLeft: {
    flex: 1,
    marginRight: 12,
  },
  mosqueName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#111',
    letterSpacing: -0.3,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  ratingStar: { fontSize: 14 },
  ratingText: { fontSize: 14, fontWeight: '600', color: '#333' },
  ratingCount: { fontSize: 13, color: '#888' },
  headerRight: {
    alignItems: 'flex-end',
    gap: 8,
  },
  paginationRow: {
    flexDirection: 'row',
    gap: 6,
  },
  pageBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageBtnDisabled: {
    backgroundColor: '#f8fafc',
  },
  pageBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#334155',
  },
  pageBtnTextDisabled: {
    color: '#cbd5e1',
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { fontSize: 16, color: '#666', fontWeight: 'bold' },

  // Photo
  photoWrapper: {
    width: '100%',
    height: 250,
    marginBottom: 16,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
    backgroundColor: '#eee',
  },
  photoPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#f2f2f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: { fontSize: 40 },

  // Prayer Overlay
  prayerOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    paddingTop: 6,
    paddingBottom: 10,
    paddingHorizontal: 8,
  },
  prayerOverlayHeader: {
    alignItems: 'flex-start',
    paddingLeft: 8,
    marginBottom: 6,
  },
  prayerOverlayApproxText: {
    color: '#bbb',
    fontSize: 9,
    fontStyle: 'italic',
  },
  prayerOverlayRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  prayerCol: {
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  prayerColActive: {
    backgroundColor: 'rgba(74, 222, 128, 0.2)', // faint green bg
    borderRadius: 12,
    overflow: 'hidden',
  },
  prayerOverlayName: {
    color: '#ccc',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
    letterSpacing: 0.5,
  },
  prayerOverlayNameActive: {
    color: '#4ade80', // sharp green
    fontWeight: '800',
  },
  prayerOverlayTime: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  prayerOverlayTimeActive: {
    color: '#4ade80', // sharp green
    fontWeight: '800',
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    backgroundColor: '#f7f8fa',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  statBox: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  statDivider: { width: 1, height: 20, backgroundColor: '#e0e0e0' },
  statLabel: { fontSize: 11, color: '#999', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { fontSize: 17, fontWeight: 'bold', color: '#111' },
  nextPrayerNotice: { fontSize: 14, color: '#2e7d32', fontWeight: '600', textAlign: 'center', marginBottom: 8 },

  // Action bar
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#f7f8fa',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  navBtn: {
    backgroundColor: '#2e7d32',
  },
  actionIcon: { fontSize: 22, marginBottom: 4 },
  actionLabel: { fontSize: 11, fontWeight: '600', color: '#444', textTransform: 'uppercase', letterSpacing: 0.3 },
  navLabel: { color: '#fff' },

  // Card
  card: {
    backgroundColor: '#f7f8fa',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  cardIcon: { fontSize: 18 },
  cardTitle: { fontSize: 15, fontWeight: 'bold', color: '#222', flex: 1 },

  // Status badge
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  openBadge: { backgroundColor: '#e8f5e9' },
  closedBadge: { backgroundColor: '#fce4ec' },
  statusText: { fontSize: 12, fontWeight: '700' },
  openBadgeText: { color: '#2e7d32' },
  closedBadgeText: { color: '#c62828' },

  // Hours
  hoursToggle: { marginBottom: 8 },
  hoursToggleText: { fontSize: 13, color: '#4A90E2', fontWeight: '600' },
  hourLine: { fontSize: 13, color: '#555', lineHeight: 22 },

  // Skeleton
  skeletonBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  skeletonText: { fontSize: 13, color: '#999' },
  noDataText: { fontSize: 13, color: '#bbb', fontStyle: 'italic' },

  // Section (non-card)
  section: { marginBottom: 16 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 15, fontWeight: 'bold', color: '#222' },

  // Cross Navigation CTA
  sectionDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginTop: 6,
    marginBottom: 12,
  },
  crossNavigateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
  },
  crossNavigateContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  crossNavigateIcon: {
    fontSize: 24,
  },
  crossNavigateText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  crossNavigateArrow: {
    fontSize: 20,
    color: '#64748B',
    fontWeight: '600',
  },

  // Transit
  transitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  transitName: { fontSize: 14, color: '#333', fontWeight: '500', flex: 1 },
  transitDist: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },

  // Parking/Halal Specifics
  parkingCard: {
    width: 220,
    marginRight: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#eee',
    justifyContent: 'space-between',
  },
  parkingInfo: {
    marginBottom: 12,
  },
  parkingRouteBtn: {
    backgroundColor: '#e3f2fd',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  parkingRouteText: {
    color: '#1976d2',
    fontWeight: '700',
    fontSize: 12,
  },
});
