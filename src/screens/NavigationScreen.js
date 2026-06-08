import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { MapboxNavigationView } from '@youssefhenna/expo-mapbox-navigation';

export default function NavigationScreen({
  userLocation,
  destination,
  routeProfile = 'driving-traffic',
  transportMode,
  onCancel,
}) {
  const [routeError, setRouteError] = useState(null);
  const { theme } = useTheme();

  // ── Strict null-guard ───────────────────────────────────────────────────────
  // InvocationTargetException is thrown the instant MapboxNavigationView mounts
  // with missing / undefined coordinate values. Bail out early and render a
  // safe fallback rather than letting the native view initialise with bad data.
  const originLat = userLocation?.coords?.latitude;
  const originLng = userLocation?.coords?.longitude;
  const destLat   = destination?.latitude;
  const destLng   = destination?.longitude;

  const hasValidCoords =
    originLat != null && originLng != null &&
    destLat   != null && destLng   != null &&
    !isNaN(originLat) && !isNaN(originLng) &&
    !isNaN(destLat)   && !isNaN(destLng);

  if (!hasValidCoords) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2e7d32" />
        <Text style={styles.message}>Waiting for location data…</Text>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Route load error ────────────────────────────────────────────────────────
  if (routeError) {
    return (
      <View style={styles.center}>
        <Ionicons name="warning" size={48} color={theme.danger || '#d32f2f'} style={{marginBottom:16}} />
        <Text style={styles.message}>{routeError}</Text>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapboxNavigationView
        style={styles.navigation}
        coordinates={[
          { latitude: originLat, longitude: originLng },
          { latitude: destLat,   longitude: destLng   },
        ]}
        routeProfile={routeProfile}
        onCancelNavigation={onCancel}
        onRouteFailedToLoad={(e) =>
          setRouteError(
            e?.nativeEvent?.errorMessage ?? 'Failed to load route.',
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  navigation: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 24,
  },
  errorIcon: { fontSize: 48, marginBottom: 12 },
  message: {
    fontSize: 16,
    color: '#555',
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 24,
  },
  cancelBtn: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    backgroundColor: '#2e7d32',
    borderRadius: 8,
  },
  cancelText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
