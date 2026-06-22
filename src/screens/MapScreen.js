import React, {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import {
  StyleSheet, View, Text, ActivityIndicator, Linking, TouchableOpacity,
  FlatList, Image, RefreshControl
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import * as Location from 'expo-location';
import { MosqueContext } from '../context/MosqueContext';
import MosqueDetailSheet from '../components/MosqueDetailSheet';
import RoutePreviewOverlay from '../components/RoutePreviewOverlay';
import LocationSearchModal from '../components/LocationSearchModal';
import { useTheme } from '../context/ThemeContext';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { calculatePrayerTimes } from '../utils/prayerEngine';
import { usePrayerSettings } from '../context/PrayerSettingsContext';

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;
const SEARCH_RADIUS_METERS = 5000;
// Show "Search this area" button after moving more than 3km from last fetch
const SEARCH_BUTTON_THRESHOLD_METERS = 3000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decodePolyline(encoded) {
  if (!encoded) return [];
  let index = 0, lat = 0, lng = 0;
  const coords = [];
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return coords;
}

function buildTransitChain(steps) {
  if (!Array.isArray(steps)) return [];
  const iconMap = { BUS: '🚌', SUBWAY: '🚇', TRAIN: '🚆', TRAM: '🚊', FERRY: '⛴️', RAIL: '🚆' };
  return steps.map((step) => {
    if (step.travel_mode === 'WALKING') return { type: 'walk', icon: '🚶', label: step.duration?.text ?? '' };
    if (step.travel_mode === 'TRANSIT') {
      const td = step.transit_details;
      const vType = td?.line?.vehicle?.type ?? 'BUS';
      const stops = td?.num_stops;
      return {
        type: 'transit', icon: iconMap[vType] ?? '🚍',
        label: td?.line?.short_name ?? td?.line?.name ?? '',
        stops: stops ? `${stops} stop${stops > 1 ? 's' : ''}` : '',
      };
    }
    return null;
  }).filter(Boolean);
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateMinutes(distanceM, mode) {
  const roadFactor = mode === 'walking' ? 1.2 : 1.35;
  const speed = { walking: 83, 'driving-traffic': 500, transit: 267 };
  return Math.max(1, Math.round(distanceM * roadFactor / speed[mode] + (mode === 'transit' ? 4 : 0)));
}

// Round to 2dp → ~1.1 km grid cells for caching
function gridKey(lat, lng) {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}



// ─── Main Component ───────────────────────────────────────────────────────────

export default function MapScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();

  // ── Global Context ──
  const { 
    userLocation: location, mosques, halalFood, isLoading: loading, error, 
    searchArea, loadMoreMosques, fetchCount,
    searchOrigin, setSearchOrigin, searchLocationName, setSearchLocationName,
    fetchSingleMosque, geocodePlace,
    isRefreshing, forceRefreshData, searchHalalFood
  } = React.useContext(MosqueContext);

  const { theme } = useTheme();

  const [searchModalVisible, setSearchModalVisible] = useState(false);

  // ── Local State ──
  const [selectedMosque, setSelectedMosque] = useState(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isNavigationLoading, setIsNavigationLoading] = useState(false);
  const [navRouteProfile, setNavRouteProfile] = useState('driving-traffic');
  const [navDestination, setNavDestination] = useState(null);
  const [fetchingRoute, setFetchingRoute] = useState(false);

  // View Mode ('map' | 'list')
  const [viewMode, setViewMode] = useState(route?.params?.viewMode || 'map');
  const [activeCategory, setActiveCategory] = useState(route?.params?.activeCategory || 'mosque'); // 'mosque' | 'food'

  useEffect(() => {
    if (route?.params?.viewMode) {
      setViewMode(route.params.viewMode);
    }
    if (route?.params?.activeCategory) {
      setActiveCategory(route.params.activeCategory);
    }
  }, [route?.params?.viewMode, route?.params?.activeCategory]);

  const [isPreviewingRoute, setIsPreviewingRoute] = useState(false);
  const [selectedTransportMode, setSelectedTransportMode] = useState('walking');
  const [previewPolyline, setPreviewPolyline] = useState([]);
  const [previewTransitChain, setPreviewTransitChain] = useState([]);
  const [previewDurationText, setPreviewDurationText] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [customOrigin, setCustomOrigin] = useState(null);
  const [activeParkingLot, setActiveParkingLot] = useState(null);
  const [walkRouteGeoJSON, setWalkRouteGeoJSON] = useState(null);
  const [pendingWalkMosque, setPendingWalkMosque] = useState(null); // mosque to walk to after parking drive
  const [followUser, setFollowUser] = useState(true);
  const [listStartLocation, setListStartLocation] = useState(null);
  const [isStartLocationSearch, setIsStartLocationSearch] = useState(false);

  // ── Search Handlers ──
  const handleSelectLocation = async ({ placeId, text, isMosque }) => {
    setSearchModalVisible(false);
    
    if (isStartLocationSearch) {
      setIsStartLocationSearch(false);
      if (isMosque) {
        const mosque = await fetchSingleMosque(placeId);
        if (mosque) {
          setListStartLocation({ coords: { latitude: mosque.location.latitude, longitude: mosque.location.longitude }, name: text });
        }
      } else {
        const loc = await geocodePlace(placeId);
        if (loc) {
          setListStartLocation({ coords: { latitude: loc.latitude, longitude: loc.longitude }, name: text });
        }
      }
      return;
    }

    setSearchLocationName(text);
    
    if (isMosque) {
      const mosque = await fetchSingleMosque(placeId);
      if (mosque) {
        const newOrigin = { coords: { latitude: mosque.location.latitude, longitude: mosque.location.longitude } };
        setSearchOrigin(newOrigin);
        setFollowUser(false);
        
        setTimeout(() => {
          cameraRef.current?.setCamera({ centerCoordinate: [mosque.location.longitude, mosque.location.latitude], zoomLevel: 15, animationDuration: 1000 });
          setSelectedMosque(mosque);
          setTimeout(() => bottomSheetRef.current?.snapToIndex(viewMode === 'list' ? 3 : 1), 100);
        }, 400); // Allow modal to fully close before panning natively
      }
    } else {
      const loc = await geocodePlace(placeId);
      if (loc) {
        const newOrigin = { coords: { latitude: loc.latitude, longitude: loc.longitude } };
        setSearchOrigin(newOrigin);
        setFollowUser(false);
        setShowSearchButton(false);
        
        setTimeout(() => {
          cameraRef.current?.setCamera({ centerCoordinate: [loc.longitude, loc.latitude], zoomLevel: 13, animationDuration: 1000 });
        }, 400); // Allow modal to fully close before panning natively

        lastFetchedLocation.current = { lat: loc.latitude, lng: loc.longitude };
        await searchArea(loc.latitude, loc.longitude, MAX_RADIUS_METERS, newOrigin, 10, true);
      }
    }
  };

  // ── Search Area State ──
  const [showSearchButton, setShowSearchButton] = useState(false);
  const [searching, setSearching] = useState(false);
  const currentMapCenter = useRef(null);
  const lastFetchedLocation = useRef(null);
  const hasInitialCameraSettledRef = useRef(false);


  // Update camera whenever location changes, as long as the user hasn't manually panned away.
  // Using followUser as the gate instead of a one-shot ref, so a corrected GPS fix
  // (e.g. emulator mock location arriving after a stale last-known) still moves the camera.
  useEffect(() => {
    if (!location || !followUser) return;
    const isFirst = !hasInitialCameraSettledRef.current;
    if (isFirst) {
      // First fix — mark settled and record fetch origin
      hasInitialCameraSettledRef.current = true;
      lastFetchedLocation.current = { lat: location.coords.latitude, lng: location.coords.longitude };
    }
    cameraRef.current?.setCamera({
      centerCoordinate: [location.coords.longitude, location.coords.latitude],
      zoomLevel: 13,
      animationDuration: isFirst ? 1500 : 800,
    });
  }, [location, followUser]);



  // Prayer Logic
  const [prayerTimes, setPrayerTimes] = useState(null);
  const [nextPrayer, setNextPrayer] = useState(null);

  // Mosque-specific prayer state
  const [mosquePrayerTimes, setMosquePrayerTimes] = useState(null);
  const [mosqueNextPrayer, setMosqueNextPrayer] = useState(null);
  const [mosquePrayerLoading, setMosquePrayerLoading] = useState(false);

  // Route preview state
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const bottomSheetRef = useRef(null);
  const cameraRef = useRef(null);
  
  const mapStyleUrl = theme.mode === 'dark' 
    ? Mapbox.StyleURL.Dark 
    : Mapbox.StyleURL.Street;
  const mapRef = useRef(null);
  const isPreviewingRef = useRef(false);
  const isNavigatingRef = useRef(false);
  useEffect(() => { isPreviewingRef.current = isPreviewingRoute; }, [isPreviewingRoute]);
  useEffect(() => { isNavigatingRef.current = isNavigating; }, [isNavigating]);

  // Camera state tracking
  const savedCamera = useRef(null);
  const liveCameraState = useRef(null);

  // ── GeoJSON Feature Collection ─────────────────────────────────────────────
  // Store lng, lat AND name in properties so onPress can work without a re-lookup
  const displayFeatureCollection = useMemo(() => {
    const validData = (displayData || []).filter(item => {
      const lng = item.location?.longitude || item.geometry?.location?.lng;
      const lat = item.location?.latitude || item.geometry?.location?.lat;
      return typeof lng === 'number' && typeof lat === 'number' && !isNaN(lng) && !isNaN(lat);
    });

    return {
      type: 'FeatureCollection',
      features: validData.map((item, index) => {
        const lng = item.location?.longitude || item.geometry?.location?.lng;
        const lat = item.location?.latitude || item.geometry?.location?.lat;
        return {
          type: 'Feature',
          geometry: { 
            type: 'Point', 
            coordinates: [lng, lat]
          },
          properties: { 
            placeId: item.id || item.place_id,
          },
        };
      }),
    };
  }, [displayData]);

  // ── Route GeoJSON ──────────────────────────────────────────────────────────
  const routeGeoJSON = useMemo(() => {
    if (previewPolyline.length === 0) return null;
    return {
      type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: previewPolyline.map((c) => [c.longitude, c.latitude]) },
    };
  }, [previewPolyline]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const distance = useMemo(() => {
    if (!selectedMosque) return null;
    const oLat = customOrigin?.latitude ?? location?.coords?.latitude;
    const oLng = customOrigin?.longitude ?? location?.coords?.longitude;
    if (!oLat || !oLng) return null;
    return haversineDistance(oLat, oLng, selectedMosque.location.latitude, selectedMosque.location.longitude);
  }, [selectedMosque, location, customOrigin]);

  const estimatedTimes = useMemo(() => {
    if (!distance) return {};
    return {
      'driving-traffic': estimateMinutes(distance, 'driving-traffic'),
      walking: estimateMinutes(distance, 'walking'),
      transit: estimateMinutes(distance, 'transit'),
    };
  }, [distance]);

  const startLabel = customOrigin?.label ?? 'Your Location';
  const getOriginLoc = useCallback(() => {
    if (customOrigin) return { coords: { latitude: customOrigin.latitude, longitude: customOrigin.longitude } };
    if (searchOrigin) return searchOrigin;
    return location;
  }, [customOrigin, searchOrigin, location]);

  // ── Pre-fetch Initial Prayer Times (Local) ────────────────────────────────
  useEffect(() => {
    if (!location) return;
    (async () => {
      try {
        const res = await fetch(`http://api.aladhan.com/v1/timings?latitude=${location.coords.latitude}&longitude=${location.coords.longitude}&method=2`);
        const data = await res.json();
        if (data?.data?.timings) {
          setPrayerTimes(data.data.timings);
        }
      } catch (prayerErr) {
        console.error('MapScreen Prayer fetch error:', prayerErr);
      }
    })();
  }, [location]);

  // Compute Next Prayer based on live time
  useEffect(() => {
    if (!prayerTimes) return;
    const currentMs = currentTime.getHours() * 60 + currentTime.getMinutes();

    const getMs = (timeString) => {
        const timeStr = timeString.split(' ')[0];
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    };

    const fajrMs = getMs(prayerTimes.Fajr);
    const sunriseMs = getMs(prayerTimes.Sunrise);
    const dhuhrMs = getMs(prayerTimes.Dhuhr);
    const asrMs = getMs(prayerTimes.Asr);
    const maghribMs = getMs(prayerTimes.Maghrib);
    const ishaMs = getMs(prayerTimes.Isha);

    let nextName = 'Fajr';
    let nextMs = fajrMs; // Default fallback to next morning

    if (currentMs < fajrMs) { nextName = 'Fajr'; nextMs = fajrMs; }
    else if (currentMs >= fajrMs && currentMs < sunriseMs) { nextName = 'Dhuhr'; nextMs = dhuhrMs; }
    else if (currentMs >= sunriseMs && currentMs < dhuhrMs) { nextName = 'Dhuhr'; nextMs = dhuhrMs; }
    else if (currentMs >= dhuhrMs && currentMs < asrMs) { nextName = 'Asr'; nextMs = asrMs; }
    else if (currentMs >= asrMs && currentMs < maghribMs) { nextName = 'Maghrib'; nextMs = maghribMs; }
    else if (currentMs >= maghribMs && currentMs < ishaMs) { nextName = 'Isha'; nextMs = ishaMs; }
    else if (currentMs >= ishaMs) { nextName = 'Fajr'; nextMs = fajrMs + (24 * 60); /* next day */ }

    // Convert nextMs back to a concrete Date object
    const nextDateObj = new Date(currentTime);
    nextDateObj.setHours(Math.floor(nextMs / 60));
    nextDateObj.setMinutes(nextMs % 60);
    nextDateObj.setSeconds(0);
    nextDateObj.setMilliseconds(0);

    setNextPrayer({ name: nextName, timeObj: nextDateObj });
  }, [currentTime, prayerTimes]);

  // ── Mosque-Specific Prayer Times Calculation (Local) ──────────────────────
  const { asrMethod, prayerOffsets, calculationMethod, highLatitudeRule } = usePrayerSettings();

  useEffect(() => {
    if (!selectedMosque) {
      setMosquePrayerTimes(null);
      return;
    }
    const times = calculatePrayerTimes(
      selectedMosque.location.latitude,
      selectedMosque.location.longitude,
      currentTime,
      { asrMethod, prayerOffsets, calculationMethod, highLatitudeRule }
    );
    setMosquePrayerTimes(times);
  }, [selectedMosque?.id, asrMethod, prayerOffsets, calculationMethod, highLatitudeRule, currentTime.getDate()]);

  // Auto-fetch mosques and halal food when location becomes ready
  useEffect(() => {
    if (!location) return;
    const lat = searchOrigin?.coords?.latitude ?? location.coords.latitude;
    const lng = searchOrigin?.coords?.longitude ?? location.coords.longitude;
    const origin = searchOrigin ?? location;

    if (mosques.length === 0 && !loading) {
      searchArea(lat, lng, SEARCH_RADIUS_METERS, origin, 10, false);
    }
    if (halalFood.length === 0 && !loading) {
      searchHalalFood(lat, lng, origin, 10, false);
    }
  }, [location, searchOrigin, mosques.length, halalFood.length, searchArea, searchHalalFood]);

  // Dynamic density-based zoom: zoom in closer if pins are clustered near the center
  useEffect(() => {
    if (isPreviewingRoute || selectedMosque || !cameraRef.current || !displayData || displayData.length === 0) return;

    const origin = searchOrigin?.coords || location?.coords;
    if (!origin) return;
    const originLng = origin.longitude;
    const originLat = origin.latitude;

    // Filter to closest 5 pins
    const localPins = displayData.slice(0, 5);

    // If the closest pin is further than 5km, center on user at zoom 13
    const nearest = localPins[0];
    const nearestLat = nearest.location?.latitude || nearest.geometry?.location?.lat;
    const nearestLng = nearest.location?.longitude || nearest.geometry?.location?.lng;
    
    if (typeof nearestLat === 'number' && typeof nearestLng === 'number') {
      const distToNearest = haversineDistance(originLat, originLng, nearestLat, nearestLng);
      if (distToNearest > 5000) {
        cameraRef.current.setCamera({
          centerCoordinate: [originLng, originLat],
          zoomLevel: 13,
          animationDuration: 1000,
          animationMode: 'easeTo',
        });
        return;
      }
    }

    // ── Density Detection & Clustering ──
    // Determine if the pins are clustered closely together, indicating high density.
    // If so, we should focus on the cluster and apply an optimal minimum box span (zoom ~17-18)
    // so pins do not overlap but are also not street-view level 20.
    const pinsWithDistance = localPins.map(p => {
      const lat = p.location?.latitude || p.geometry?.location?.lat;
      const lng = p.location?.longitude || p.geometry?.location?.lng;
      const dist = (typeof lat === 'number' && typeof lng === 'number')
        ? haversineDistance(nearestLat, nearestLng, lat, lng)
        : Infinity;
      return { pin: p, lat, lng, dist };
    }).filter(p => p.dist !== Infinity);

    // If there is at least one other pin within 400 meters of the nearest pin,
    // we classify it as a dense cluster.
    const denseClusterPins = pinsWithDistance.filter(p => p.dist <= 400);
    const isDense = denseClusterPins.length >= 2;

    // To prevent far-away pins (outliers) from pulling the zoom out and causing
    // the cluster to overlap, we fit bounds only to the cluster if it's dense.
    const targetPins = isDense ? denseClusterPins : pinsWithDistance;

    // Include user's location coordinate so the dot is always in frame
    const coords = [
      [originLng, originLat],
      ...targetPins.map(p => [p.lng, p.lat])
    ];

    if (coords.length > 0) {
      let maxLat = Math.max(...coords.map(c => c[1]));
      let minLat = Math.min(...coords.map(c => c[1]));
      let maxLng = Math.max(...coords.map(c => c[0]));
      let minLng = Math.min(...coords.map(c => c[0]));

      // If dense, use a minBoxSpan that keeps the zoom around 17.5 - 18.0 (approx 0.0012)
      // Otherwise, use 0.002 to keep the zoom around 16.5 - 17.0.
      const minBoxSpan = isDense ? 0.0012 : 0.002;
      const latDiff = maxLat - minLat;
      const lngDiff = maxLng - minLng;

      if (latDiff < minBoxSpan) {
        const pad = (minBoxSpan - latDiff) / 2;
        maxLat += pad;
        minLat -= pad;
      }
      if (lngDiff < minBoxSpan) {
        const pad = (minBoxSpan - lngDiff) / 2;
        maxLng += pad;
        minLng -= pad;
      }

      cameraRef.current.setCamera({
        bounds: {
          ne: [maxLng, maxLat],
          sw: [minLng, minLat],
          paddingTop: 120,
          paddingBottom: 280,
          paddingLeft: 80,
          paddingRight: 80,
        },
        animationDuration: 1000,
        animationMode: 'easeTo',
      });
    }
  }, [activeCategory, displayData, isPreviewingRoute, selectedMosque?.id, viewMode]);

  // Compute Next Prayer for the explicitly selected Mosque
  useEffect(() => {
    if (!mosquePrayerTimes) {
      setMosqueNextPrayer(null);
      return;
    }
    const currentMs = currentTime.getHours() * 60 + currentTime.getMinutes();

    const getMs = (timeString) => {
        const timeStr = timeString.split(' ')[0];
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    };

    const fajrMs = getMs(mosquePrayerTimes.Fajr);
    const sunriseMs = getMs(mosquePrayerTimes.Sunrise);
    const dhuhrMs = getMs(mosquePrayerTimes.Dhuhr);
    const asrMs = getMs(mosquePrayerTimes.Asr);
    const maghribMs = getMs(mosquePrayerTimes.Maghrib);
    const ishaMs = getMs(mosquePrayerTimes.Isha);

    let nextName = 'Fajr';
    let nextMs = fajrMs;

    if (currentMs < fajrMs) { nextName = 'Fajr'; nextMs = fajrMs; }
    else if (currentMs >= fajrMs && currentMs < sunriseMs) { nextName = 'Dhuhr'; nextMs = dhuhrMs; }
    else if (currentMs >= sunriseMs && currentMs < dhuhrMs) { nextName = 'Dhuhr'; nextMs = dhuhrMs; }
    else if (currentMs >= dhuhrMs && currentMs < asrMs) { nextName = 'Asr'; nextMs = asrMs; }
    else if (currentMs >= asrMs && currentMs < maghribMs) { nextName = 'Maghrib'; nextMs = maghribMs; }
    else if (currentMs >= maghribMs && currentMs < ishaMs) { nextName = 'Isha'; nextMs = ishaMs; }
    else if (currentMs >= ishaMs) { nextName = 'Fajr'; nextMs = fajrMs + (24 * 60); }

    const nextDateObj = new Date(currentTime);
    nextDateObj.setHours(Math.floor(nextMs / 60));
    nextDateObj.setMinutes(nextMs % 60);
    nextDateObj.setSeconds(0);
    nextDateObj.setMilliseconds(0);

    setMosqueNextPrayer({ name: nextName, timeObj: nextDateObj });
  }, [currentTime, mosquePrayerTimes]);

  // ── Camera State Tracking (for restore on close) ───────────────────────────
  const isUserInteracting = useRef(false);

  const handleCameraChanged = useCallback((state) => {
    if (state?.properties?.center) {
      liveCameraState.current = {
        centerCoordinate: state.properties.center,
        zoomLevel: state.properties.zoom ?? 14,
      };
    }
    if (state?.gestures?.isGestureActive) {
      isUserInteracting.current = true;
    }
  }, []);

  // ── Map Idle / Area Searching ────────────────────────────────────────────────
  const handleMapIdle = useCallback((state) => {
    if (isPreviewingRef.current || !location) return;
    const [lng, lat] = state.properties.center;
    const zoom = state.properties.zoom;
    currentMapCenter.current = { lat, lng };

    // Prevent fetch logic from running before Mapbox mechanically zooms in from bounds 0
    if (!hasInitialCameraSettledRef.current) {
      if (zoom >= 10) hasInitialCameraSettledRef.current = true;
      return;
    }

    if (!lastFetchedLocation.current) return;
    
    // Only show "Search this area" button if the map was manually dragged/zoomed by the user
    if (isUserInteracting.current) {
      const moved = haversineDistance(
        lastFetchedLocation.current.lat, lastFetchedLocation.current.lng, lat, lng,
      );
      
      // Suggest refreshing if user drags map 3km away from last hit
      if (moved > 3000) {
        setShowSearchButton(true);
      }
      isUserInteracting.current = false; // Reset gesture flag
    }
  }, [location]);

  const handleSearchThisArea = useCallback(async () => {
    if (!currentMapCenter.current) return;
    setShowSearchButton(false);
    setSearching(true);
    const { lat, lng } = currentMapCenter.current;
    
    await searchArea(lat, lng, 10000, location);
    
    lastFetchedLocation.current = { lat, lng };
    setSearching(false);
  }, [searchArea, location]);

  // ── Route Fetching ─────────────────────────────────────────────────────────
  const fetchRouteForMode = useCallback(async (mode, mosque, originLoc) => {
    if (!mosque || !originLoc) return;
    setPreviewLoading(true);
    setPreviewPolyline([]);
    setPreviewDurationText(null);
    setPreviewTransitChain([]);
    try {
      const googleMode = { 'driving-traffic': 'driving', walking: 'walking', transit: 'transit' }[mode] ?? 'driving';
      const oLat = originLoc.coords.latitude, oLng = originLoc.coords.longitude;
      const dLat = mosque.location.latitude, dLng = mosque.location.longitude;
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${oLat},${oLng}&destination=${dLat},${dLng}&mode=${googleMode}&alternatives=true&key=${GOOGLE_PLACES_API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status === 'OK' && data.routes?.length) {
        const leg = data.routes[0].legs[0];
        const decoded = decodePolyline(data.routes[0].overview_polyline?.points);
        setPreviewPolyline(decoded);
        setPreviewDurationText(leg.duration?.text ?? null);
        if (mode === 'transit') setPreviewTransitChain(buildTransitChain(leg.steps));
        if (decoded.length > 0) {
          const lats = decoded.map((c) => c.latitude), lngs = decoded.map((c) => c.longitude);
          cameraRef.current?.setCamera({
            bounds: {
              ne: [Math.max(...lngs), Math.max(...lats)], sw: [Math.min(...lngs), Math.min(...lats)],
              paddingTop: 200, paddingBottom: 180, paddingLeft: 30, paddingRight: 30,
            },
            animationDuration: 900, animationMode: 'easeTo',
          });
        }
      }
    } catch (err) { console.error('Route fetch error:', err); } finally { setPreviewLoading(false); }
  }, []);

  // ── Marker tap via ShapeSource.onPress ─────────────────────────────────────
  const openPlaceSheet = useCallback((fullPlace) => {
    console.log('Opening Sheet for:', fullPlace?.displayName?.text || fullPlace?.name);

    if (!fullPlace || !fullPlace.location) return;

    if (liveCameraState.current) {
      savedCamera.current = { ...liveCameraState.current };
    }
    setFollowUser(false);
    cameraRef.current?.setCamera({
      centerCoordinate: [
        fullPlace.location.longitude || fullPlace.geometry?.location?.lng, 
        fullPlace.location.latitude || fullPlace.geometry?.location?.lat
      ],
      zoomLevel: 15,
      animationDuration: 500,
      animationMode: 'easeTo',
      padding: { paddingBottom: 260, paddingTop: 0, paddingLeft: 0, paddingRight: 0 },
    });

    // Pass the FULL nested object to the bottom sheet!
    setSelectedMosque(fullPlace);
    const targetIndex = viewMode === 'list' ? 3 : 1;
    bottomSheetRef.current?.snapToIndex(targetIndex);
  }, [viewMode]);

  // ── Auto-open Deeplinked Place ─────────────────────────────────────────────
  useEffect(() => {
    if (route?.params?.selectedPlaceId && displayData?.length > 0) {
      const index = displayData.findIndex(item => item.id === route.params.selectedPlaceId);
      if (index !== -1) {
        
        const isPreviewMode = !!route?.params?.previewRoute;
        
        // Clear the param properly using React Navigation setParams
        // This stops the infinite re-render loop on the Map screen
        navigation.setParams({
           selectedPlaceId: undefined,
           previewRoute: undefined
        });
        
        if (isPreviewMode) {
           // Open the route chooser overlay (NOT turn-by-turn navigation)
           setSelectedMosque(displayData[index]);
           setIsPreviewingRoute(true);
           bottomSheetRef.current?.close();
        } else {
           // Normal open-sheet mode
           openPlaceSheet(displayData[index]);
        }
      }
    }
  }, [route?.params?.selectedPlaceId, route?.params?.previewRoute, displayData, openPlaceSheet, navigation]);

  const handleShapePress = useCallback((event) => {
    if (!event?.features?.[0]) return;
    const props = event.features[0].properties;
    if (!props || !props.placeId) return;
    
    // Find matching index in currently active dataset by ID
    const match = displayData.find(item => item.id === props.placeId || item.place_id === props.placeId);
    if (match) {
      openPlaceSheet(match);
    }
  }, [displayData, openPlaceSheet]);

  // ── Sheet Change Handler (restore camera on close) ─────────────────────────
  const handleSheetChange = useCallback((index) => {
    if (index === -1) {
      if (isPreviewingRef.current || isNavigatingRef.current) return;
      
      if (savedCamera.current) {
        cameraRef.current?.setCamera({
          centerCoordinate: savedCamera.current.centerCoordinate,
          zoomLevel: savedCamera.current.zoomLevel,
          animationDuration: 500,
          animationMode: 'easeTo',
          padding: { paddingBottom: 0, paddingTop: 0, paddingLeft: 0, paddingRight: 0 },
        });
        savedCamera.current = null;
      }
      setSelectedMosque(null);
      if (!searchOrigin) setFollowUser(true);
      
      // Auto-fetch surrounding mosques if we only have 1 (from a specific mosque search)
      if (mosques.length === 1 && searchOrigin) {
        searchArea(searchOrigin.coords.latitude, searchOrigin.coords.longitude, MAX_RADIUS_METERS, searchOrigin, 10, false);
      }
    }
  }, [mosques.length, searchOrigin, searchArea]);

  const handleCloseSheet = useCallback(() => { bottomSheetRef.current?.close(); }, []);

  const handleOpenPreview = useCallback(() => {
    setIsPreviewingRoute(true);
    setSelectedTransportMode('walking');
    bottomSheetRef.current?.close();
    fetchRouteForMode('walking', selectedMosque, getOriginLoc());
  }, [selectedMosque, getOriginLoc, fetchRouteForMode]);

  const handleModeChange = useCallback((mode) => {
    setSelectedTransportMode(mode);
    fetchRouteForMode(mode, selectedMosque, getOriginLoc());
  }, [selectedMosque, getOriginLoc, fetchRouteForMode]);

  const handlePreviewBack = useCallback(() => {
    setIsPreviewingRoute(false);
    setPreviewPolyline([]);
    setPreviewTransitChain([]);
    setPreviewDurationText(null);
    setActiveParkingLot(null);
    setWalkRouteGeoJSON(null);
    if (selectedMosque) {
      setTimeout(() => {
        const targetIndex = viewMode === 'list' ? 3 : 1;
        bottomSheetRef.current?.snapToIndex(targetIndex);
      }, 100);
    }
    if (location) cameraRef.current?.setCamera({ centerCoordinate: [location.coords.longitude, location.coords.latitude], zoomLevel: 13, animationDuration: 700 });
  }, [selectedMosque, location, viewMode]);

  const handleStartLocationChange = useCallback((latitude, longitude, label) => {
    if (latitude === null) { setCustomOrigin(null); fetchRouteForMode(selectedTransportMode, selectedMosque, location); }
    else { setCustomOrigin({ latitude, longitude, label }); fetchRouteForMode(selectedTransportMode, selectedMosque, { coords: { latitude, longitude } }); }
  }, [selectedTransportMode, selectedMosque, fetchRouteForMode, location]);

  const handleStart = useCallback((transportMode, activeDestination) => {
    setIsPreviewingRoute(false); setPreviewPolyline([]);
    const oLat = customOrigin?.latitude ?? location?.coords?.latitude;
    const oLng = customOrigin?.longitude ?? location?.coords?.longitude;
    // activeDestination may be a parking lot { lat, lng } or the mosque itself
    const isParkingLot = activeDestination?.lat != null;
    const dLat = activeDestination?.lat ?? activeDestination?.location?.latitude ?? selectedMosque?.location?.latitude;
    const dLng = activeDestination?.lng ?? activeDestination?.location?.longitude ?? selectedMosque?.location?.longitude;
    if (transportMode === 'transit') {
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${oLat},${oLng}&destination=${dLat},${dLng}&travelmode=transit`);
      return;
    }
    // If navigating to a parking lot, queue the mosque as the follow-up walk leg
    if (isParkingLot && selectedMosque) {
      setPendingWalkMosque(selectedMosque);
    } else {
      setPendingWalkMosque(null);
    }
    isNavigatingRef.current = true;
    setNavDestination({ latitude: dLat, longitude: dLng });
    setNavRouteProfile(transportMode === 'walking' ? 'walking' : 'driving-traffic');
    setIsNavigationLoading(true);
    setTimeout(() => {
      setIsNavigating(true);
      setTimeout(() => setIsNavigationLoading(false), 1500);
    }, 50);
  }, [customOrigin, selectedMosque, location]);

  const handleDestinationChange = useCallback(async (dest) => {
    if (!dest) return;
    const isParkingLot = dest.lat != null;
    const destLocation = isParkingLot
      ? { latitude: dest.lat, longitude: dest.lng }
      : dest.location;
    fetchRouteForMode(selectedTransportMode, { ...selectedMosque, location: destLocation }, getOriginLoc());

    if (isParkingLot) {
      setActiveParkingLot(dest);
      // Fetch walking route from car park → mosque
      try {
        const mosLat = selectedMosque?.location?.latitude;
        const mosLng = selectedMosque?.location?.longitude;
        const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${dest.lat},${dest.lng}&destination=${mosLat},${mosLng}&mode=walking&alternatives=false&key=${GOOGLE_PLACES_API_KEY}`;
        const res = await fetch(url);
        const data = await res.json();
        const points = data.routes?.[0]?.overview_polyline?.points;
        if (points) {
          const decoded = decodePolyline(points);
          if (decoded.length > 0) {
            setWalkRouteGeoJSON({
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: decoded.map(c => [c.longitude, c.latitude]),
              },
            });
          }
        }
      } catch (err) {
        console.error('Walk route fetch error:', err);
      }
    } else {
      setActiveParkingLot(null);
      setWalkRouteGeoJSON(null);
    }
  }, [selectedTransportMode, selectedMosque, getOriginLoc, fetchRouteForMode]);

  const handleCancelNavigation = useCallback(() => {
    setIsNavigating(false);
    isNavigatingRef.current = false;
    setIsNavigationLoading(false);
    // If there's a pending walk leg (after parking drive), re-open directions in walk mode
    if (pendingWalkMosque) {
      const mosque = pendingWalkMosque;
      setPendingWalkMosque(null);
      setActiveParkingLot(null);
      setWalkRouteGeoJSON(null);
      setSelectedMosque(mosque);
      setTimeout(() => {
        setIsPreviewingRoute(true);
        setSelectedTransportMode('walking');
        fetchRouteForMode('walking', mosque, location);
      }, 400);
    }
  }, [pendingWalkMosque, location, fetchRouteForMode]);

  // ── sortedMosques MUST be before any early returns (React hook rules) ──────
  const sortedMosques = useMemo(() => {
    if (!listStartLocation) return mosques || [];
    return [...(mosques || [])].map(m => {
      const pLat = m.location?.latitude || m.geometry?.location?.lat;
      const pLng = m.location?.longitude || m.geometry?.location?.lng;
      if (!pLat || !pLng) return m;
      const distMeters = haversineDistance(
        listStartLocation.coords.latitude,
        listStartLocation.coords.longitude,
        pLat, pLng
      );
      return { ...m, distMeters };
    }).sort((a, b) => a.distMeters - b.distMeters);
  }, [mosques, listStartLocation]);

  const sortedFood = useMemo(() => {
    if (!listStartLocation) return halalFood || [];
    return [...(halalFood || [])].map(f => {
      const pLat = f.location?.latitude || f.geometry?.location?.lat;
      const pLng = f.location?.longitude || f.geometry?.location?.lng;
      if (!pLat || !pLng) return f;
      const distMeters = haversineDistance(
        listStartLocation.coords.latitude,
        listStartLocation.coords.longitude,
        pLat, pLng
      );
      return { ...f, distMeters };
    }).sort((a, b) => a.distMeters - b.distMeters);
  }, [halalFood, listStartLocation]);

  const displayData = activeCategory === 'mosque' ? sortedMosques : sortedFood;

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (loading || !location) return <View style={styles.center}><ActivityIndicator size="large" color="#4A90E2" /><Text style={styles.loadingText}>Finding your location…</Text></View>;
  if (error) {
    return (
      <View style={styles.center}>
        <Ionicons name='location-outline' size={48} color={theme.text} style={{marginBottom: 16}} />
        <Text style={styles.errorMessage}>{error}</Text>
      </View>
    );
  }
  if (isNavigating && navDestination && location) {
    const NavigationScreen = require('./NavigationScreen').default;
    return (
      <NavigationScreen userLocation={location} destination={navDestination} routeProfile={navRouteProfile} onCancel={handleCancelNavigation} />
    );
  }

  // Helper to render the Mosque FlatList cards
  const renderMosqueCard = ({ item }) => {
    const distMeters = item.distMeters;
    let distText = '—';
    if (distMeters) {
      const miles = distMeters * 0.000621371;
      distText = miles >= 0.1 ? `${miles.toFixed(1)} mi` : `${Math.round(distMeters * 3.28084)} ft`;
    }
    const walkMins = Math.round(distMeters / 80);
    let photoUrl = null;
    if (item.photos?.[0]?.name) {
      photoUrl = `https://places.googleapis.com/v1/${item.photos[0].name}/media?maxWidthPx=200&key=${process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY}`;
    } else if (item.photos?.[0]?.photo_reference) {
      photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=200&photo_reference=${item.photos[0].photo_reference}&key=${process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY}`;
    }

    return (
      <TouchableOpacity
        style={[styles.uberCard, { backgroundColor: theme.card }]}
        onPress={() => openPlaceSheet(item)}
        activeOpacity={0.7}
      >
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.uberImage} />
        ) : (
          <View style={[styles.uberImagePlaceholder, { backgroundColor: theme.chipBg }]}>
            <MaterialCommunityIcons name={activeCategory === 'food' ? 'silverware-fork-knife' : 'mosque'} size={24} color={theme.text} />
          </View>
        )}

        <View style={styles.uberInfo}>
          <Text style={[styles.uberName, { color: theme.text }]} numberOfLines={1}>{item.displayName?.text || item.name}</Text>
          <Text style={{ fontSize: 13, color: theme.primary, marginTop: 2, fontWeight: '700' }}>
            <Ionicons name='star' size={14} color='#fbc02d' /> {item.rating ? item.rating.toFixed(1) : 'New'}
          </Text>
          {item.formattedAddress && (
            <Text style={{ fontSize: 13, color: theme.subText, marginTop: 4, fontWeight: '500' }} numberOfLines={1}>{item.formattedAddress}</Text>
          )}
          {item.regularOpeningHours?.openNow === false && (
            <Text style={styles.uberClosedText}>Closed</Text>
          )}
        </View>

        <View style={styles.uberMetrics}>
          <Text style={[styles.uberWalk, { color: theme.text }]}>{walkMins} min</Text>
          <Text style={[styles.uberDist, { color: theme.subText }]}>{distText}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <LocationSearchModal 
        visible={searchModalVisible} 
        onClose={() => setSearchModalVisible(false)} 
        onSelect={handleSelectLocation} 
      />

      {/* ── Top Controls: Location Search Pill & Category Toggle ── */}
      {!isNavigating && !isPreviewingRoute && (
        <View style={[styles.topControlsContainer, { top: insets.top + (viewMode === 'list' ? 10 : 16) }]} pointerEvents="box-none">
          {/* Location Search Pill */}
          <TouchableOpacity 
            style={[styles.searchPill, { backgroundColor: theme.card }]} 
            onPress={() => setSearchModalVisible(true)}
            activeOpacity={0.8}
          >
            <Ionicons name='location-sharp' size={16} color={theme.primary} style={styles.searchPillIcon} />
            <Text style={[styles.searchPillText, { color: theme.text }]} numberOfLines={1}>
               {searchLocationName}
            </Text>
            <Text style={[styles.searchPillChevron, { color: theme.subText }]}>⌄</Text>
          </TouchableOpacity>

          {/* Category Toggle */}
          <View style={[styles.categoryTogglePill, { backgroundColor: theme.card }]}>
            <TouchableOpacity
              style={[styles.categoryToggleSegment, activeCategory === 'mosque' && [styles.toggleSegmentActive, { backgroundColor: theme.tint }]]}
              onPress={() => {
                setActiveCategory('mosque');
                setSelectedMosque(null);
                bottomSheetRef.current?.close();
              }}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name='mosque' size={20} color={activeCategory === 'mosque' ? '#fff' : theme.text} style={[styles.toggleSegmentIcon, activeCategory === 'mosque' && styles.toggleSegmentIconActive]} />
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.categoryToggleSegment, activeCategory === 'food' && [styles.toggleSegmentActive, { backgroundColor: '#B5651D' }]]}
              onPress={() => {
                setActiveCategory('food');
                setSelectedMosque(null);
                bottomSheetRef.current?.close();
              }}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name='silverware-fork-knife' size={20} color={activeCategory === 'food' ? '#fff' : theme.text} style={[styles.toggleSegmentIcon, activeCategory === 'food' && styles.toggleSegmentIconActive]} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── MAIN VIEW: MAP ── */}
      {!isNavigating && (
        <View style={viewMode === 'map' ? { flex: 1 } : { display: 'none' }}>
          <Mapbox.MapView
            ref={mapRef}
            style={styles.map}
            styleURL={mapStyleUrl}
            logoEnabled={false}
            compassEnabled={false}
            scaleBarEnabled={false}
            onMapIdle={handleMapIdle}
            onCameraChanged={handleCameraChanged}
            onPress={(feature) => console.log('[MapScreen] Global MapView tapped! Coordinates:', feature?.geometry?.coordinates)}
          >
            <Mapbox.Camera
              ref={cameraRef}
              defaultSettings={{
                centerCoordinate: searchOrigin
                  ? [searchOrigin.coords.longitude, searchOrigin.coords.latitude]
                  : [location.coords.longitude, location.coords.latitude],
                zoomLevel: 13,
              }}
            />

            <Mapbox.UserLocation visible={true} />

            <Mapbox.ShapeSource
              key={`places-source-${activeCategory}`}
              id={`places-source-${activeCategory}`}
              shape={displayFeatureCollection}
              onPress={handleShapePress}
              hitbox={{ width: 44, height: 44 }}
            />

            {/* Using MarkerView for custom React Native UI components! 
                Capped at top 20 nearest places to completely eliminate Android map lag
                while perfectly preserving standard React Native UI rendering without native clipping bugs. */}
            {(isPreviewingRoute ? (displayData || []).filter(m => m.id === selectedMosque?.id) : (displayData || []))
              .filter(item => {
                const lng = item.location?.longitude || item.geometry?.location?.lng;
                const lat = item.location?.latitude || item.geometry?.location?.lat;
                return typeof lng === 'number' && typeof lat === 'number' && !isNaN(lng) && !isNaN(lat);
              })
              .slice(0, 20)
              .map((item, index) => {
                const lng = item.location?.longitude || item.geometry?.location?.lng;
                const lat = item.location?.latitude || item.geometry?.location?.lat;

                return (
                <Mapbox.PointAnnotation
                  key={`pa-${activeCategory}-${item.id || item.place_id || index.toString()}`}
                  id={`pa-${activeCategory}-${item.id || index}`}
                  coordinate={[lng, lat]}
                  onSelected={() => openPlaceSheet(item)}
                >
                  <View style={styles.markerWrapper}>
                    <View style={[styles.marker, activeCategory === 'food' ? { backgroundColor: '#B5651D' } : {}]}>
                      <MaterialCommunityIcons name={activeCategory === 'food' ? 'silverware-fork-knife' : 'mosque'} size={18} color='#fff' />
                    </View>
                    <View style={[styles.markerStem, activeCategory === 'food' ? { backgroundColor: '#B5651D' } : {}]} />
                  </View>
                </Mapbox.PointAnnotation>
              )})}

            {/* Drive/transit route line */}
            {routeGeoJSON && (
              <Mapbox.ShapeSource id="routeSource" shape={routeGeoJSON}>
                <Mapbox.LineLayer id="routeCasing" style={{ lineColor: '#fff', lineWidth: 9, lineCap: 'round', lineJoin: 'round' }} />
                <Mapbox.LineLayer
                  id="routeLine"
                  style={{
                    // Blue when driving to a car park or transit; green for direct walk/drive to mosque
                    lineColor: activeParkingLot ? '#1565C0' : (selectedTransportMode === 'transit' ? '#1565C0' : '#2e7d32'),
                    lineWidth: 5, lineCap: 'round', lineJoin: 'round',
                    lineDasharray: selectedTransportMode === 'transit' ? [2, 1.5] : [],
                  }}
                />
              </Mapbox.ShapeSource>
            )}

            {/* Walk route: car park → mosque (dashed green) */}
            {walkRouteGeoJSON && (
              <Mapbox.ShapeSource id="walkRouteSource" shape={walkRouteGeoJSON}>
                <Mapbox.LineLayer id="walkRouteCasing" style={{ lineColor: '#fff', lineWidth: 7, lineCap: 'round', lineJoin: 'round' }} />
                <Mapbox.LineLayer
                  id="walkRouteLine"
                  style={{ lineColor: '#2e7d32', lineWidth: 4, lineCap: 'round', lineJoin: 'round', lineDasharray: [0, 2] }}
                />
              </Mapbox.ShapeSource>
            )}

            {/* Car park marker */}
            {activeParkingLot && (
              <Mapbox.MarkerView
                id="parking-marker"
                coordinate={[activeParkingLot.lng, activeParkingLot.lat]}
                allowOverlap
              >
                <View style={styles.markerWrapper}>
                  <View style={[styles.marker, { backgroundColor: '#1565C0' }]}>
                    <MaterialCommunityIcons name='parking' size={18} color='#fff' />
                  </View>
                  <View style={[styles.markerStem, { backgroundColor: '#1565C0' }]} />
                </View>
              </Mapbox.MarkerView>
            )}
          </Mapbox.MapView>
        </View>
      )}

      {/* ── DIRECTIONS MODE: transparent overlay over the existing map ── */}
      {isPreviewingRoute && selectedMosque && (
        <RoutePreviewOverlay
          mosque={selectedMosque}
          activeCategory={activeCategory}
          selectedMode={selectedTransportMode}
          onModeChange={handleModeChange}
          transitChain={previewTransitChain}
          durationText={previewDurationText}
          loading={previewLoading}
          onBack={handlePreviewBack}
          onStart={handleStart}
          onDestinationChange={handleDestinationChange}
          distance={distance}
          estimatedTimes={estimatedTimes}
          startLabel={startLabel}
          onStartLocationChange={handleStartLocationChange}
          nextPrayer={mosqueNextPrayer}
        />
      )}

      {/* ── CONDITIONAL MAIN VIEW: LIST ── */}
      {!isNavigating && viewMode === 'list' && (
        <View style={[styles.listContainer, { backgroundColor: theme.background }]}>
          <View style={[styles.listHeader, { paddingTop: insets.top + (showSearchButton ? 55 : 45), backgroundColor: theme.background }]}>
            <View>
              <Text style={[styles.listHeaderTitle, { color: theme.text }]}>
                {activeCategory === 'food' ? 'Nearby Halal Food' : 'Nearby Mosques'}
              </Text>
              <TouchableOpacity 
                style={[styles.listHeaderLocationPill, { backgroundColor: theme.chipBg }]}
                onPress={() => { setIsStartLocationSearch(true); setSearchModalVisible(true); }}
                activeOpacity={0.7}
              >
                <Ionicons name='location-sharp' size={18} color={theme.primary} />
                <Text style={[styles.listHeaderLocationText, { color: theme.text }]} numberOfLines={1}>
                  <Text style={{color: theme.subText, fontWeight: '500'}}>Start: </Text>
                  {listStartLocation?.name || 'Your Location'}
                </Text>
                <Text style={[styles.listHeaderLocationChevron, { color: theme.subText }]}>⌄</Text>
              </TouchableOpacity>
            </View>
            {showSearchButton && (
              <TouchableOpacity
                style={styles.listHeaderSearchButton}
                onPress={handleSearchThisArea}
                activeOpacity={0.85}
              >
                {searching
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.listHeaderSearchButtonText}>Search Area</Text>}
              </TouchableOpacity>
            )}
          </View>
          <FlatList
            data={displayData}
            keyExtractor={(item) => item.id}
            renderItem={renderMosqueCard}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={forceRefreshData}
                tintColor="#059669"
                colors={['#059669']}
              />
            }
            ListFooterComponent={() => {
              if (activeCategory === 'food') return null;
              if (fetchCount >= 20) return null;
              return (
                <View style={styles.loadMoreContainer}>
                  <TouchableOpacity
                    style={styles.loadMoreButton}
                    onPress={loadMoreMosques}
                    disabled={loading}
                    activeOpacity={0.7}
                  >
                    {loading ? (
                      <ActivityIndicator size="small" color="#059669" />
                    ) : (
                      <Text style={styles.loadMoreButtonText}>Load More Mosques</Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            }}
          />
        </View>
      )}

      {/* ── "Search this area" floating button for Map View ──── */}
      {showSearchButton && !isPreviewingRoute && viewMode === 'map' && (
        <TouchableOpacity
          style={[styles.searchButton, { top: insets.top + 76 }]}
          onPress={handleSearchThisArea}
          activeOpacity={0.85}
        >
          {searching
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.searchButtonText}><Ionicons name='search' size={14} color='#fff'/> Search this area</Text>}
        </TouchableOpacity>
      )}

      {/* ── View Mode Toggle ── */}
      {!isNavigating && !isPreviewingRoute && (
        <View style={[styles.togglePillContainer, { bottom: insets.bottom + 30 }]} pointerEvents="box-none">
          <View style={[styles.togglePill, { backgroundColor: theme.card, shadowColor: theme.mode === 'dark' ? '#000' : '#475569' }]}>
            <TouchableOpacity
              style={[styles.toggleSegment, viewMode === 'map' && [styles.toggleSegmentActive, { backgroundColor: theme.tint }]]}
              onPress={() => setViewMode('map')}
              activeOpacity={0.8}
            >
              <Ionicons name='map-outline' size={20} color={viewMode === 'map' ? '#fff' : theme.text} style={[styles.toggleSegmentIcon, viewMode === 'map' && styles.toggleSegmentIconActive]} />
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.toggleSegment, viewMode === 'list' && [styles.toggleSegmentActive, { backgroundColor: theme.tint }]]}
              onPress={() => setViewMode('list')}
              activeOpacity={0.8}
            >
              <Ionicons name="list-outline" size={20} color={viewMode === 'list' ? '#fff' : theme.text} style={[styles.toggleSegmentIcon, viewMode === 'list' && styles.toggleSegmentIconActive]} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Bottom Sheet — sibling to map, elevated above Android Mapbox layer ─
          elevation + zIndex force Android to draw this above the native map.   */}
      {!isPreviewingRoute && (
        <View style={styles.sheetContainer} pointerEvents="box-none">
          <MosqueDetailSheet
            ref={bottomSheetRef}
            mosque={selectedMosque}
            mosques={displayData}
            setSelectedMosque={setSelectedMosque}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            userLocation={location}
            estimatedTimes={estimatedTimes}
            nextPrayer={mosqueNextPrayer}
            mosquePrayerTimes={mosquePrayerTimes}
            mosquePrayerLoading={mosquePrayerLoading}
            onClose={handleCloseSheet}
            onStartNavigating={handleOpenPreview}
            onChange={handleSheetChange}
            setViewMode={setViewMode}
          />
        </View>
      )}



      {/* ── Navigation Loading Overlay ── */}
      {isNavigationLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.loadingOverlayText}>Starting Navigation...</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  map: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  loadingText: { marginTop: 16, fontSize: 16, color: '#666' },
  errorIcon: { fontSize: 48, marginBottom: 12 },
  errorMessage: { fontSize: 16, color: '#d32f2f', textAlign: 'center', paddingHorizontal: 20 },
  suspenseTitle: { marginTop: 20, fontSize: 20, fontWeight: '700', color: '#111' },

  // Top Controls Container
  topControlsContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    zIndex: 100,
  },
  
  // Location Search Pill
  searchPill: {
    flex: 1, // take remaining space
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    height: 48,
    borderRadius: 24,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
  },
  searchPillIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  searchPillText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
    flexShrink: 1,
  },
  searchPillChevron: {
    fontSize: 16,
    color: '#64748B',
    marginLeft: 6,
    marginTop: -4,
  },

  // "Search this area" floating button — top uses insets so it clears the notch
  searchButton: {
    position: 'absolute',
    // top is set inline via style prop so it can use the insets hook value
    alignSelf: 'center',
    backgroundColor: '#2e7d32',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    elevation: 8,
    zIndex: 99,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  searchButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // Category Toggle Pill (Top right)
  categoryTogglePill: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 24,
    height: 48,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  categoryToggleSegment: {
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    backgroundColor: 'transparent',
    height: '100%',
  },

  // View Toggle Segmented Pill
  togglePillContainer: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 99,
  },
  togglePill: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 30,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  toggleSegment: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: 'transparent',
  },
  toggleSegmentActive: {
    backgroundColor: '#0F172A', // Slate 900 for dark mode premium feel
  },
  toggleSegmentIcon: {
    fontSize: 18,
    opacity: 0.55,
  },
  toggleSegmentIconActive: {
    opacity: 1.0,
  },

  // List View Styles
  listContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC', // Very light grey/blue
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#fff',
  },
  listHeaderTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
  },
  listHeaderLocationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9', // Slate 100
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  listHeaderLocationIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  listHeaderLocationText: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '600',
    maxWidth: 200,
  },
  listHeaderLocationChevron: {
    fontSize: 14,
    color: '#64748B',
    marginLeft: 6,
    fontWeight: '700',
    marginTop: -2,
  },
  listHeaderSearchButton: {
    backgroundColor: '#059669',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  listHeaderSearchButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: 120, // space for toggle button
  },

  loadMoreContainer: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  loadMoreButton: {
    backgroundColor: '#D1FAE5', // Emerald Light
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  loadMoreButtonText: {
    color: '#059669', // Emerald Dark
    fontWeight: '700',
    fontSize: 14,
  },
  uberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9', // ultra light separator
  },
  uberImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
  },
  uberImagePlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uberInfo: {
    flex: 1,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  uberName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  uberClosedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E11D48', // rose-600
    marginTop: 2,
    textTransform: 'uppercase',
  },
  uberMetrics: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  uberWalk: {
    fontSize: 16,
    fontWeight: '700',
    color: '#059669', // emerald
  },
  uberDist: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B', // slate grey
    marginTop: 2,
  },
  // Bottom Sheet wrapper — elevated above Android map layer
  sheetContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    elevation: 10,
  },

  // Mosque/Food markers
  markerWrapper: { alignItems: 'center', justifyContent: 'flex-start' },
  marker: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#1b5e20',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: '#fff',
    elevation: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4, shadowRadius: 4,
  },
  markerEmoji: { fontSize: 24 },
  markerStem: {
    width: 4, height: 12, backgroundColor: '#1b5e20',
    borderBottomLeftRadius: 2, borderBottomRightRadius: 2, elevation: 2,
  },

  // Loading Overlay
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    zIndex: 9999,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 20,
  },
  loadingOverlayText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16,
    letterSpacing: 0.5,
  },
});
