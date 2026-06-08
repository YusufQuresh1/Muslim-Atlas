import { Ionicons } from '@expo/vector-icons';
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Modal, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { SafeAreaView } from 'react-native-safe-area-context';

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;

const generateSessionToken = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export default function LocationSearchModal({ visible, onClose, onSelect }) {
  const { theme } = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionToken, setSessionToken] = useState(null);
  
  const inputRef = useRef(null);

  // Initialize session token and focus input when modal opens
  useEffect(() => {
    if (visible) {
      setSessionToken(generateSessionToken());
      setQuery('');
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setSessionToken(null);
    }
  }, [visible]);

  // Debounced Search Effect (500ms)
  useEffect(() => {
    const fetchPredictions = async () => {
      if (!query.trim() || query.trim().length < 3) {
        setResults([]);
        return;
      }

      try {
        setIsLoading(true);
        const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
          },
          body: JSON.stringify({
            input: query,
            sessionToken: sessionToken,
          })
        });
        
        const data = await res.json();
        setResults(data.suggestions || []);
      } catch (err) {
        console.error('Autocomplete fetch error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    const handler = setTimeout(() => {
      fetchPredictions();
    }, 500);

    return () => clearTimeout(handler);
  }, [query, sessionToken]);

  const handleSelectPrediction = (suggestion) => {
    const prediction = suggestion.placePrediction;
    if (!prediction) return;

    const placeId = prediction.placeId;
    const text = prediction.text?.text || '';
    const types = prediction.types || [];
    
    const isMosque = types.includes('mosque') || types.includes('place_of_worship');

    onSelect({ placeId, text, isMosque });
  };

  const renderItem = ({ item }) => {
    const prediction = item.placePrediction;
    if (!prediction) return null;

    const mainText = prediction.structuredFormat?.mainText?.text || prediction.text?.text;
    const secondaryText = prediction.structuredFormat?.secondaryText?.text || '';
    const types = prediction.types || [];
    const isMosque = types.includes('mosque') || types.includes('place_of_worship');

    return (
      <TouchableOpacity 
        style={styles.resultItem} 
        onPress={() => handleSelectPrediction(item)}
      >
        <Text style={styles.icon}>{isMosque ? '🕌' : '📍'}</Text>
        <View style={styles.resultTextContainer}>
          <Text style={[styles.mainText, { color: theme.text }]} numberOfLines={1}>{mainText}</Text>
          {secondaryText ? (
            <Text style={[styles.secondaryText, { color: theme.subText }]} numberOfLines={1}>{secondaryText}</Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
        <View style={[styles.header, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
          <View style={[styles.searchBar, { backgroundColor: theme.chipBg }]}>
            <Ionicons name="search" size={20} color={theme.subText} style={styles.searchIcon} />
            <TextInput
              ref={inputRef}
              style={[styles.input, { color: theme.text }]}
              placeholder="Search city, neighborhood, or mosque..."
              placeholderTextColor={theme.subText}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="words"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} style={styles.clearBtn}>
                <Text style={[styles.clearBtnText, { color: theme.subText }]}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
            <Text style={[styles.cancelBtnText, { color: theme.primary }]}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={theme.primary} />
          </View>
        )}

        <FlatList
          data={results}
          keyExtractor={(item, index) => item.placePrediction?.placeId || index.toString()}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContainer}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
    height: '100%',
  },
  clearBtn: {
    padding: 4,
  },
  clearBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  cancelBtn: {
    marginLeft: 16,
  },
  cancelBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  listContainer: {
    paddingBottom: 40,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  icon: {
    fontSize: 24,
    marginRight: 16,
  },
  resultTextContainer: {
    flex: 1,
  },
  mainText: {
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryText: {
    fontSize: 14,
    marginTop: 2,
  },
});
