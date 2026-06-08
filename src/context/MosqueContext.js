import React, { createContext, useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

  const searchHalalFood = async (lat, lng, refLocation = searchOrigin || userLocation, limit = fetchCount, clearPrevious = false) => {
    try {
      if (clearPrevious) {
        setHalalFood([]);
        // Optional: you might want a separate fetch count if they are kept separate, 
        // but since both use `fetchCount` globally right now, we can update it:
        setFetchCount(limit);
      }
      
      const safeLat = Number(lat);
      const safeLng = Number(lng);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress,places.rating,places.userRatingCount,places.photos',
        },
        body: JSON.stringify({
          textQuery: 'halal food OR halal takeaway OR halal chicken shop',
          maxResultCount: limit,
          locationBias: {
            circle: {
              center: { latitude: safeLat, longitude: safeLng },
              radius: 5000.0,
            }
          }
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data.places) {
        const enriched = data.places.map(p => {
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
      }));

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
      const cached = await loadCachedData();
      const lastFetchTime = cached.location?.lastFetchTime || 0;

      const ageHours = (Date.now() - lastFetchTime) / (1000 * 60 * 60);

      // Tier 1: Cooldown (< 60s)
      if (Date.now() - lastFetchTime < 60000) {
        console.log("Smart Refresh Tier 1: Cooldown (Skipping)");
        setIsRefreshing(false);
        return;
      }

      // Tier 2: Stale (> 30 days)
      if (ageHours > 720) {
        console.log("Smart Refresh Tier 2: Stale Cache (Refetching API)");
        setFetchCount(10);
        await Promise.all([
           searchArea(origin.coords.latitude, origin.coords.longitude, MAX_RADIUS_METERS, origin, 10, true),
           searchHalalFood(origin.coords.latitude, origin.coords.longitude, origin, 10, true)
        ]);
        setIsRefreshing(false);
        return;
      }

      if (cached.location && cached.mosques?.length > 0) {
        const displacement = haversineDistance(
          origin.coords.latitude, origin.coords.longitude,
          cached.location.latitude, cached.location.longitude
        );

        // Tier 3: Micro Move (< 50m)
        if (displacement < 50) {
          console.log("Smart Refresh Tier 3: Micro Move < 50m (Skipping)");
          setIsRefreshing(false);
          return;
        }

        // Tier 4: Local Resorting
        if (displacement >= 50 && displacement < 2000) {
          console.log(`Smart Refresh Tier 4: Local Resorting (Moved ${Math.round(displacement)}m)`);
          const resortedMosques = resortCachedItems(cached.mosques, origin.coords.latitude, origin.coords.longitude);
          const resortedFood = resortCachedItems(cached.halalFood, origin.coords.latitude, origin.coords.longitude);

          setMosques(resortedMosques);
          if (resortedFood?.length) {
            setHalalFood(resortedFood);
            await saveDataToCache(resortedMosques, resortedFood, origin);
          } else {
            await saveDataToCache(resortedMosques, cached.halalFood, origin);
          }
          
          setIsRefreshing(false);
          return;
        }
      }

      // Tier 5: Macro Move (> 2000m)
      console.log("Smart Refresh Tier 5: Macro Move > 2000m (Refetching API)");
      setFetchCount(10);
      await Promise.all([
         searchArea(origin.coords.latitude, origin.coords.longitude, MAX_RADIUS_METERS, origin, 10, true),
         searchHalalFood(origin.coords.latitude, origin.coords.longitude, origin, 10, true)
      ]);
    } catch (e) {
      console.error('Force Refresh Error:', e);
    }
    
    setIsRefreshing(false);
  };

  useEffect(() => {
    (async () => {
      try {
        setIsLoading(true);
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setError('Location permission denied.');
          return;
        }

        // Try last-known first (instant) — safe 500ms window
        const lastKnown = await Promise.race([
          Location.getLastKnownPositionAsync().catch(() => null),
          new Promise(resolve => setTimeout(() => resolve(null), 500)),
        ]);
        const loc = lastKnown ?? await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null),
          new Promise(resolve => setTimeout(() => resolve(null), 12000)),
        ]);
        // Load cached metadata immediately
        const cached = await loadCachedData();
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
          
          // Cost-Saving Reverse Geocoder Cache
          // If we haven't moved more than 5km from the last cached start, reuse the string!
          if (displacement < 5000 && cached.locationName) {
              setSearchLocationName(cached.locationName);
              // Avoid API hit
          } else {
              // We moved significantly. Hit Google Geocoder API.
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
                    // Ultimate fallback using local device SDK
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
        } else if (!hasCachedMosques) {
          console.warn('Boot: No location and no cache — using London fallback. Deferring fetch.');
          // Fallback to central London if everything fails so the app is not empty
          const fallbackLoc = {
            coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 0 },
            timestamp: Date.now()
          };
          setUserLocation(fallbackLoc);
          setSearchLocationName("London (Fallback)");
        }
      } catch (err) {
        console.error('Global MosqueContext init error:', err);
        setError('Failed to initialize location.');
      } finally {
        setIsLoading(false);
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
    }}>
      {children}
    </MosqueContext.Provider>
  );
};
