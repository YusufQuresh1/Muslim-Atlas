import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import * as Location from 'expo-location';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { updateAppWidgets } from '../../widget-task-handler';

export const MosqueContext = createContext();
import { doc, getDoc, setDoc, serverTimestamp, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../firebaseConfig';

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;
const MAX_RADIUS_METERS = 30000;

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const MosqueProvider = ({ children }) => {
  const [userLocation, setUserLocation] = useState(null);
  const [searchOrigin, setSearchOrigin] = useState(null);
  const [searchLocationName, setSearchLocationName] = useState('Current Location');
  const [mosques, setMosques] = useState([]);
  const [halalFood, setHalalFood] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [fetchCount, setFetchCount] = useState(10);
  const [firebaseData, setFirebaseData] = useState({});

  const saveDataToCache = async (mosquesData, halalFoodData, locData) => {
    try {
      if (mosquesData) await AsyncStorage.setItem('@cached_mosques', JSON.stringify(mosquesData));
      if (halalFoodData) await AsyncStorage.setItem('@cached_halalfood', JSON.stringify(halalFoodData));
      
      // Store bare coordinates and latest geocoded name for cost-saving
      if (locData?.coords) {
        await AsyncStorage.setItem('@cached_location', JSON.stringify({
          latitude: locData.coords.latitude,
          longitude: locData.coords.longitude,
          lastFetchTime: Date.now()
        }));
      }
      if (locData?.name) {
        await AsyncStorage.setItem('@cached_location_name', locData.name);
      }
      // Instantly trigger widget refresh on location changes
      updateAppWidgets().catch(console.warn);
    } catch (e) {
      console.warn('Failed to save data to cache', e);
    }
  };

  const resortCachedItems = (items, lat, lng) => {
    if (!items) return [];
    return items.map(p => {
      const pLat = p.location?.latitude || p.geometry?.location?.lat;
      const pLng = p.location?.longitude || p.geometry?.location?.lng;
      if (!pLat || !pLng) return p;
      const distMeters = haversineDistance(lat, lng, pLat, pLng);
      return { ...p, distMeters };
    }).sort((a, b) => a.distMeters - b.distMeters);
  };

  const loadCachedData = async () => {
    try {
      const storedMosques = await AsyncStorage.getItem('@cached_mosques');
      const storedFood = await AsyncStorage.getItem('@cached_halalfood');
      const storedLoc = await AsyncStorage.getItem('@cached_location');
      const storedLocName = await AsyncStorage.getItem('@cached_location_name');
      return {
        mosques: storedMosques ? JSON.parse(storedMosques) : null,
        halalFood: storedFood ? JSON.parse(storedFood) : null,
        location: storedLoc ? JSON.parse(storedLoc) : null,
        locationName: storedLocName || null
      };
    } catch (e) {
      console.warn('Failed to load cached data', e);
      return { mosques: null, halalFood: null, location: null };
    }
  };

  const searchArea = async (lat, lng, radius = MAX_RADIUS_METERS, refLocation = searchOrigin || userLocation, limit = fetchCount, clearPrevious = false) => {
    try {
      setIsLoading(true);
      if (clearPrevious) {
        setMosques([]);
        setFetchCount(limit);
      }
      
      const safeLat = Number(lat);
      const safeLng = Number(lng);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress,places.types,places.photos,places.regularOpeningHours,places.rating,places.userRatingCount',
        },
        body: JSON.stringify({
          includedTypes: ['mosque'],
          maxResultCount: limit,
          rankPreference: 'DISTANCE',
          locationRestriction: {
            circle: {
              center: { latitude: safeLat, longitude: safeLng },
              radius: radius,
            },
          },
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const data = await response.json();
      if (data.error) {
        console.warn('Google Places API Error:', data.error.message);
      }
      if (data.places) {
        const excluded = ['church', 'hindu_temple'];
        const filtered = data.places.filter((p) => {
          const types = p.types || [];
          return types.includes('mosque') && !types.some((t) => excluded.includes(t));
        });
        
        const enriched = filtered.map(p => {
          const pLat = p.location?.latitude;
          const pLng = p.location?.longitude;
          const refLat = refLocation?.coords?.latitude || lat;
          const refLng = refLocation?.coords?.longitude || lng;
          const distMeters = (pLat && pLng) ? haversineDistance(refLat, refLng, pLat, pLng) : 999999;
          
          // ── Passive L2 Hydration ──
          try {
            setDoc(doc(db, 'places', p.id), p, { merge: true });
          } catch (err) {
            console.error('[Passive Hydration Error]', err);
          }

          return { ...p, distMeters };
        });

        setMosques(prev => {
          let updatedMosques = clearPrevious ? [] : [...prev];
          const existingIds = new Set(updatedMosques.map(m => m.id));
          const newOnes = enriched.filter(m => !existingIds.has(m.id));
          const masterArray = [...updatedMosques, ...newOnes].sort((a, b) => a.distMeters - b.distMeters);
          
          // Optionally cache here if this is the primary location query
          if (!searchOrigin) {
             saveDataToCache(masterArray, halalFood, refLocation);
          }
          return masterArray;
        });
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.warn('searchArea fetch timed out');
      } else {
        console.error('searchArea fetch error:', err);
      }
      setError('Failed to fetch nearby mosques.');
    } finally {
      setIsLoading(false);
    }
  };

  const searchHalalFood = async (lat, lng, refLocation = searchOrigin || userLocation, limit = 20, clearPrevious = false) => {
    try {
      if (clearPrevious) {
        setHalalFood([]);
      }
      
      const safeLat = Number(lat);
      const safeLng = Number(lng);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      
      // Perform two parallel queries to get a much larger and higher quality list of food spots
      const [res1, res2] = await Promise.all([
        fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress,places.rating,places.userRatingCount,places.photos,places.regularOpeningHours,places.types',
          },
          body: JSON.stringify({
            textQuery: 'halal restaurant',
            maxResultCount: limit,
            rankPreference: 'DISTANCE',
            locationBias: {
              circle: {
                center: { latitude: safeLat, longitude: safeLng },
                radius: 5000.0,
              }
            }
          }),
          signal: controller.signal
        }),
        fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress,places.rating,places.userRatingCount,places.photos,places.regularOpeningHours,places.types',
          },
          body: JSON.stringify({
            textQuery: 'halal takeaway OR halal food OR halal kebab OR halal burger',
            maxResultCount: limit,
            rankPreference: 'DISTANCE',
            locationBias: {
              circle: {
                center: { latitude: safeLat, longitude: safeLng },
                radius: 5000.0,
              }
            }
          }),
          signal: controller.signal
        })
      ]);
      
      clearTimeout(timeoutId);
      
      const [data1, data2] = await Promise.all([
        res1.json().catch(() => ({})),
        res2.json().catch(() => ({}))
      ]);
      
      const places1 = data1.places || [];
      const places2 = data2.places || [];
      const combinedPlaces = [...places1, ...places2];
      
      // Deduplicate by place ID
      const uniquePlacesMap = new Map();
      combinedPlaces.forEach(p => {
        if (p && p.id) {
          uniquePlacesMap.set(p.id, p);
        }
      });
      const uniquePlaces = Array.from(uniquePlacesMap.values());
      
      if (uniquePlaces.length > 0) {
        const enriched = uniquePlaces.map(p => {
          const pLat = p.location?.latitude;
          const pLng = p.location?.longitude;
          const refLat = refLocation?.coords?.latitude || lat;
          const refLng = refLocation?.coords?.longitude || lng;
          const distMeters = (pLat && pLng) ? haversineDistance(refLat, refLng, pLat, pLng) : 999999;
          
          // ── Passive L2 Hydration ──
          try {
            setDoc(doc(db, 'places', p.id), p, { merge: true });
          } catch (err) {
            console.error('[Passive Hydration Error]', err);
          }

          return {
            ...p,
            distMeters 
          };
        }).sort((a, b) => a.distMeters - b.distMeters);
        
        let returnedArray = [];
        setHalalFood(prev => {
          let updatedFood = clearPrevious ? [] : [...(prev || [])];
          const existingIds = new Set(updatedFood.map(m => m.id));
          const newOnes = enriched.filter(m => !existingIds.has(m.id));
          const masterArray = [...updatedFood, ...newOnes].sort((a, b) => a.distMeters - b.distMeters);
          
          if (!searchOrigin) {
            AsyncStorage.setItem('@cached_halalfood', JSON.stringify(masterArray)).catch(console.warn);
          }
          returnedArray = masterArray;
          return masterArray;
        });
        return returnedArray;
      }
      return [];
    } catch (err) {
      if (err.name === 'AbortError') {
        console.warn('searchHalalFood fetch timed out');
      } else {
        console.error('searchHalalFood fetch error:', err);
      }
      return [];
    }
  };

  const fetchSingleMosque = async (placeId, refLocation = searchOrigin || userLocation) => {
    try {
      setIsLoading(true);
      const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
        headers: {
          'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': 'id,displayName,location,formattedAddress,types,photos,regularOpeningHours,rating,userRatingCount',
        },
      });
      const data = await res.json();
      if (data.id) {
        const pLat = data.location?.latitude;
        const pLng = data.location?.longitude;
        const refLat = refLocation?.coords?.latitude || pLat;
        const refLng = refLocation?.coords?.longitude || pLng;
        const distMeters = (pLat && pLng) ? haversineDistance(refLat, refLng, pLat, pLng) : 0;
        const enriched = { ...data, distMeters };
        setMosques([enriched]); // We only fetch one and overwrite
        return enriched;
      }
    } catch (err) {
      console.error('fetchSingleMosque error:', err);
      setError('Failed to fetch specific mosque.');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const geocodePlace = async (placeId) => {
    try {
      const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}?fields=location`, {
        headers: { 'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY }
      });
      const data = await res.json();
      return data.location; // { latitude, longitude }
    } catch (err) {
      console.error('geocodePlace error:', err);
      return null;
    }
  };

  // ── Deep per-place cache (mosque OR food) ───────────────────────────────
  const fetchPlaceDeepData = useCallback(async (place, category = 'mosque') => {
    if (!place?.id) return null;
    const cacheKey = `@place_details_${place.id}`;
    try {
      const stored = await AsyncStorage.getItem(cacheKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        const ageHours = (Date.now() - (parsed.timestamp || 0)) / 3600000;
        if (ageHours < 720) {
          console.log(`[L1 HIT] Deep Cache [${category}]: ${place.displayName?.text || place.name}`);
          return parsed;
        }
      }
    } catch (_) {}

    console.log(`[L1 MISS] Deep Cache [${category}]: ${place.displayName?.text || place.name}`);

    // ── STEP 2: L2 Cache (Firebase Firestore) ──
    try {
      const docRef = doc(db, 'places', place.id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const fbData = docSnap.data();
        if (fbData.has_deep_data) {
          // Check expiration
          const lastUpdated = fbData.last_updated?.toDate ? fbData.last_updated.toDate().getTime() : 0;
          const ageHours = (Date.now() - lastUpdated) / 3600000;
          
          if (ageHours < 720) {
            console.log(`[L2 HIT] Firebase Deep Cache: ${place.displayName?.text || place.name}`);
            
            // Hydrate local cache
            await AsyncStorage.setItem(cacheKey, JSON.stringify(fbData));
            return fbData;
          } else {
            console.log(`[L2 EXPIRED] Firebase Deep Cache: ${place.displayName?.text || place.name}`);
          }
        }
      }
    } catch (err) {
      console.error(`[L2 ERROR] Failed to fetch deep data from Firebase:`, err);
    }

    console.log(`[L3 FETCH] Google Places API: ${place.displayName?.text || place.name}`);
    const lat = place.location.latitude;
    const lng = place.location.longitude;



    try {
      const [detailsRes, transitRes] = await Promise.all([
        fetch(`https://places.googleapis.com/v1/places/${place.id}`, {
          headers: {
            'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
            'X-Goog-FieldMask': 'websiteUri,regularOpeningHours,rating,userRatingCount',
          },
        }),
        fetch('https://places.googleapis.com/v1/places:searchNearby', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
            'X-Goog-FieldMask': 'places.displayName,places.location',
          },
          body: JSON.stringify({
            includedTypes: ['transit_station'],
            maxResultCount: 2,
            locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 1000.0 } },
          }),
        }),
      ]);

      const details = await detailsRes.json();
      const transitData = await transitRes.json();

      const transit = (transitData.places || []).map((s) => ({
        name: s.displayName?.text,
        distance: Math.round(haversineDistance(lat, lng, s.location.latitude, s.location.longitude)),
      })).sort((a, b) => a.distance - b.distance);

      let result;
      if (category === 'mosque') {
        result = { details, transit, food: [], parking: null, timestamp: Date.now() };
      } else {
        result = { details, transit, nearbyMosques: [], parking: null, timestamp: Date.now() };
      }

      // ── HYDRATE L1 & L2 CACHES ──
      try {
        const enrichedRef = doc(db, 'places', place.id);
        await setDoc(enrichedRef, {
          ...result,
          has_deep_data: true,
          last_updated: serverTimestamp(),
        }, { merge: true });
        console.log(`[L2 Hydrated] Wrote deep data to Firebase for: ${place.displayName?.text || place.name}`);
      } catch (err) {
        console.error('[L2 Hydration Error]', err);
      }

      await AsyncStorage.setItem(cacheKey, JSON.stringify(result));
      return result;
    } catch (err) {
      console.error('fetchPlaceDeepData error:', err);
      return null;
    }
  }, []);

  // Backward-compat alias (used by RoutePreviewOverlay parking logic)
  const fetchMosqueDeepData = useCallback((place) => fetchPlaceDeepData(place, 'mosque'), [fetchPlaceDeepData]);

  const appendParkingToCache = async (placeId, parkingData) => {
    const cacheKey = `@place_details_${placeId}`;
    try {
      const stored = await AsyncStorage.getItem(cacheKey);
      const existing = stored ? JSON.parse(stored) : {};
      await AsyncStorage.setItem(cacheKey, JSON.stringify({ ...existing, parking: parkingData }));
    } catch (err) {
      console.error('appendParkingToCache error:', err);
    }
  };

  const loadMoreMosques = async () => {
    const origin = searchOrigin || userLocation;
    if (!origin || fetchCount >= 20) return; // Hard cap around 20 places
    const nextLimit = fetchCount + 10;
    setFetchCount(nextLimit);
    await searchArea(origin.coords.latitude, origin.coords.longitude, MAX_RADIUS_METERS, origin, nextLimit, false);
  };

  const forceRefreshData = async () => {
    const origin = searchOrigin || userLocation;
    if (!origin) return;
    setIsRefreshing(true);

    try {
      setFetchCount(10);
      await Promise.all([
         searchArea(origin.coords.latitude, origin.coords.longitude, MAX_RADIUS_METERS, origin, 10, true),
         searchHalalFood(origin.coords.latitude, origin.coords.longitude, origin, 20, true)
      ]);
    } catch (e) {
      console.error('Force Refresh Error:', e);
    }
    
    setIsRefreshing(false);
  };

  // ── Re-check location when app comes to foreground ───────────────────────
  const lastKnownCoords = useRef(null);
  // Prevents refreshUserLocation from racing with boot init
  const isInitialized = useRef(false);

  const refreshUserLocation = useCallback(async () => {
    // Don't run until boot has fully completed — prevents racing with initial GPS fix
    if (!isInitialized.current) return;
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const loc = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
        new Promise(resolve => setTimeout(() => resolve(null), 8000)),
      ]);

      if (!loc) return;

      const newLat = loc.coords.latitude;
      const newLng = loc.coords.longitude;

      // Only update if moved more than 500m from last known position
      const prev = lastKnownCoords.current;
      const movedEnough = !prev || haversineDistance(prev.lat, prev.lng, newLat, newLng) > 500;

      lastKnownCoords.current = { lat: newLat, lng: newLng };
      setUserLocation(loc);

      if (movedEnough) {
        // Re-geocode location name
        fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${newLat},${newLng}&key=${GOOGLE_PLACES_API_KEY}`)
          .then(res => res.json())
          .then(data => {
            let localName = null;
            if (data.status === 'OK' && data.results?.length > 0) {
              let allComponents = [];
              for (const result of data.results) {
                allComponents = allComponents.concat(result.address_components);
              }
              const typesToFind = ['neighborhood', 'sublocality_level_1', 'sublocality', 'locality', 'postal_town'];
              for (const t of typesToFind) {
                const match = allComponents.find(c => c.types.includes(t));
                if (match) { localName = match.short_name || match.long_name; break; }
              }
            }
            if (localName) {
              setSearchLocationName(localName);
              AsyncStorage.setItem('@cached_location_name', localName).catch(console.warn);
              AsyncStorage.setItem('@cached_location', JSON.stringify({
                latitude: newLat,
                longitude: newLng,
                lastFetchTime: Date.now(),
              })).catch(console.warn);
            } else {
              Location.reverseGeocodeAsync({ latitude: newLat, longitude: newLng })
                .then(addresses => {
                  if (addresses?.length > 0) {
                    const addr = addresses[0];
                    const fallbackName = addr.district || addr.city || addr.subregion || addr.region || 'Current Location';
                    setSearchLocationName(fallbackName);
                    AsyncStorage.setItem('@cached_location_name', fallbackName).catch(console.warn);
                  }
                }).catch(console.warn);
            }
            // Always update widget with new coordinates
            updateAppWidgets().catch(console.warn);
          }).catch(console.warn);
      } else {
        // Moved less than 500m — still update widget in case prayer times shifted
        updateAppWidgets().catch(console.warn);
      }
    } catch (err) {
      console.warn('refreshUserLocation error:', err);
    }
  }, []);

  // Listen for app coming to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        refreshUserLocation();
      }
    });
    return () => subscription.remove();
  }, [refreshUserLocation]);

  useEffect(() => {
    (async () => {
      try {
        setIsLoading(true);
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setError('Location permission denied.');
          return;
        }

        // Always fetch a fresh High-accuracy fix so the emulator mock location is respected.
        // Skipping getLastKnownPositionAsync — it can return a stale network-based position
        // that bypasses the GPS provider entirely.
        const loc = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null),
          new Promise(resolve => setTimeout(() => resolve(null), 12000)),
        ]);

        // Load cached metadata immediately
        let cached = await loadCachedData();
        const cacheVer = await AsyncStorage.getItem('@cache_version');
        if (cacheVer !== 'v2') {
          await AsyncStorage.removeItem('@cached_mosques');
          await AsyncStorage.removeItem('@cached_halalfood');
          await AsyncStorage.removeItem('@cached_location');
          await AsyncStorage.setItem('@cache_version', 'v2');
          cached = { mosques: null, halalFood: null, location: null, locationName: null };
        }
        const lastFetchTime = cached.location?.lastFetchTime || 0;
        const cacheAgeHours = (Date.now() - lastFetchTime) / (1000 * 60 * 60);
        const hasCachedMosques = cached.mosques?.length > 0;
        
        // Calculate displacement if we have both live loc and cached loc
        let displacement = 999999;
        if (loc && cached.location) {
           displacement = haversineDistance(
              loc.coords.latitude, loc.coords.longitude,
              cached.location.latitude, cached.location.longitude
           );
        }

        if (loc) {
          setUserLocation(loc);
          
          // Show cached name immediately (fast boot), always re-geocode in background
          // so the precise area name (e.g. "Shoreditch" not just "London") is always accurate.
          if (cached.locationName) {
            setSearchLocationName(cached.locationName);
          }

          // Always fire a background geocode — updates name if location has changed at all
          fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${loc.coords.latitude},${loc.coords.longitude}&key=${GOOGLE_PLACES_API_KEY}`)
            .then(res => res.json())
            .then(data => {
              let localName = null;
              if (data.status === 'OK' && data.results && data.results.length > 0) {
                let allComponents = [];
                for (const res of data.results) {
                  allComponents = allComponents.concat(res.address_components);
                }
                const typesToFind = ['neighborhood', 'sublocality_level_1', 'sublocality', 'locality', 'postal_town'];
                for (const t of typesToFind) {
                  const match = allComponents.find(c => c.types.includes(t));
                  if (match) {
                    localName = match.short_name || match.long_name;
                    break;
                  }
                }
              }
              if (data.status === 'REQUEST_DENIED') {
                console.warn('Geocoding API failed. Ensure "Geocoding API" is enabled in Google Cloud Console.');
              }

              if (localName) {
                setSearchLocationName(localName);
                AsyncStorage.setItem('@cached_location_name', localName).catch(console.warn);
              } else {
                // Fallback using local device SDK
                Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
                  .then(addresses => {
                    if (addresses && addresses.length > 0) {
                      const addr = addresses[0];
                      const fallbackName = addr.district || addr.city || addr.subregion || addr.region || 'Current Location';
                      setSearchLocationName(fallbackName);
                      AsyncStorage.setItem('@cached_location_name', fallbackName).catch(console.warn);
                    }
                  }).catch(console.warn);
              }
            }).catch(console.warn);
        }

        // If GPS failed but we have a cached position, use it as a fallback location
        // so downstream screens (HomeScreen prayer times, MapScreen) still get coordinates
        if (!loc && cached.location?.latitude) {
          setUserLocation({
            coords: {
              latitude: cached.location.latitude,
              longitude: cached.location.longitude,
              accuracy: 0,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: cached.location.lastFetchTime || Date.now(),
          });
        }

        if (hasCachedMosques) {
          // Re-sort by current location if available, otherwise show as-is
          const refLat = loc?.coords?.latitude ?? cached.location?.latitude;
          const refLng = loc?.coords?.longitude ?? cached.location?.longitude;
          if (refLat && refLng) {
            const resortedMosques = resortCachedItems(cached.mosques, refLat, refLng);
            const resortedFood = resortCachedItems(cached.halalFood, refLat, refLng);
            setMosques(resortedMosques);
            if (resortedFood?.length) setHalalFood(resortedFood);
          } else {
            setMosques(cached.mosques);
            if (cached.halalFood?.length) setHalalFood(cached.halalFood);
          }

          // Check if cache is still fresh and we haven't moved far
          if (loc && cached.location && cacheAgeHours < 720) {
            if (displacement < 2000) {
              console.log('Boot: Cache hit, skipping API fetch');
              return; // Cache is good — done
            }
          }
        }

        // No valid cache or location moved significantly — fetch fresh data
        if (loc) {
          console.log('Boot: Location ready. Deferring API data fetch to active screens.');
          if (displacement >= 2000 || cacheAgeHours >= 720) {
            setMosques([]);
            setHalalFood([]);
          }
        } else if (!hasCachedMosques) {
          // GPS failed and no cached data — show a proper error rather than faking a location
          console.warn('Boot: No location and no cache — cannot determine location.');
          setError('Unable to determine your location. Please check location permissions and try again.');
        }
      } catch (err) {
        console.error('Global MosqueContext init error:', err);
        setError('Failed to initialize location.');
      } finally {
        setIsLoading(false);
        isInitialized.current = true; // Allow AppState listener to run after this point
      }
    })();
  }, []);

  // ── Real Firebase Reads ───────────────────────────────
  const fetchPlaceFromFirebase = useCallback(async (placeId) => {
    if (!placeId) return;
    try {
      const docRef = doc(db, 'places', placeId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        setFirebaseData(prev => ({ ...prev, [placeId]: data }));
      }
    } catch (err) {
      console.error('Failed to fetch from Firebase:', err);
    }
  }, []);

  const getCrowdsourcedData = useCallback((placeId) => {
    if (!placeId) return null;
    return firebaseData[placeId] || {};
  }, [firebaseData]);

  return (
    <MosqueContext.Provider value={{ 
      userLocation, setUserLocation, 
      searchOrigin, setSearchOrigin,
      searchLocationName, setSearchLocationName,
      mosques, setMosques, 
      halalFood, setHalalFood,
      isLoading, isRefreshing, error, 
      searchArea, loadMoreMosques, forceRefreshData,
      fetchCount, setFetchCount,
      fetchSingleMosque, geocodePlace,
      fetchMosqueDeepData, fetchPlaceDeepData, appendParkingToCache,
      fetchPlaceFromFirebase, getCrowdsourcedData,
      searchHalalFood,
    }}>
      {children}
    </MosqueContext.Provider>
  );
};
