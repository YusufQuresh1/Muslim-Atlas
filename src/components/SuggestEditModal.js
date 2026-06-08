import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Switch,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { MosqueContext } from '../context/MosqueContext';
import { AuthContext } from '../context/AuthContext';
import { useContext } from 'react';

const SuggestEditModal = ({ visible, onClose, mosque, initialData }) => {
  const insets = useSafeAreaInsets();
  const { fetchPlaceFromFirebase } = useContext(MosqueContext);
  const { user } = useContext(AuthContext);
  const { theme } = useTheme();
  
  // Initialize form state
  const [formState, setFormState] = useState({
    hasWomens: false,
    wheelchair: false,
    wudu: false,
    jummahTimes: [],
  });

  // Sync with initialData when modal opens or initialData deeply changes
  useEffect(() => {
    if (visible && initialData) {
      setFormState({
        hasWomens: !!initialData.hasWomens,
        wheelchair: !!initialData.wheelchair,
        wudu: !!initialData.wudu,
        jummahTimes: Array.isArray(initialData.jummahTimes) ? [...initialData.jummahTimes] : [],
      });
    }
  }, [visible, JSON.stringify(initialData)]);

  if (!mosque) return null;

  const handleToggle = (field) => {
    setFormState(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  const handleRemoveTime = (indexToRemove) => {
    setFormState(prev => ({
      ...prev,
      jummahTimes: prev.jummahTimes.filter((_, idx) => idx !== indexToRemove)
    }));
  };

  const handleAddTime = () => {
    // For now, push a placeholder string. Real app might launch a TimePicker.
    setFormState(prev => ({
      ...prev,
      jummahTimes: [...prev.jummahTimes, '13:00']
    }));
  };

  const handleSubmit = async () => {
    if (!mosque?.id || !user?.uid) {
      Alert.alert("Error", "You must be logged in to suggest an edit.");
      return;
    }

    try {
      const docRef = doc(db, 'places', mosque.id);
      const snapshot = await getDoc(docRef);
      const currentData = snapshot.exists() ? snapshot.data() : {};
      
      const payload = {};
      
      // Fields to process through consensus
      const fields = ['hasWomens', 'wheelchair', 'wudu'];
      
      fields.forEach(field => {
        const newValue = formState[field];
        
        // If the suggested value is already the confirmed main value, skip
        if (currentData[field]?.value === newValue) return;

        const pendingObj = currentData[`pending_${field}`] || {};
        const stringifiedVal = String(newValue); // keys must be strings
        
        const existingPending = pendingObj[stringifiedVal];
        
        if (existingPending) {
           // Check if user already voted for this pending edit
           if (existingPending.voted_by?.includes(user.uid)) {
              // User already voted, skip logic
              return;
           }
           
           const newVotes = (existingPending.votes || 0) + 1;
           const newVoters = [...(existingPending.voted_by || []), user.uid];

           if (newVotes >= 3) {
             // Threshold met: Promote to main value!
             payload[field] = {
               value: newValue,
               confirmations: 3,
               voted_by: newVoters,
             };
             // Clear pending edits for this field since a consensus was reached
             payload[`pending_${field}`] = {}; 
           } else {
             // Just add the vote
             pendingObj[stringifiedVal] = {
               votes: newVotes,
               voted_by: newVoters
             };
             payload[`pending_${field}`] = pendingObj;
           }
        } else {
           // First time this specific value is suggested
           pendingObj[stringifiedVal] = {
             votes: 1,
             voted_by: [user.uid]
           };
           payload[`pending_${field}`] = pendingObj;
        }
      });
      
      // Array handling for Jummah Times (complex, we will just direct overwrite for now 
      // or save as a single object but for phase 13, let's just stick to the main spec for boolean amenities first)
      payload.jummahTimes = formState.jummahTimes; // Retaining basic overwrite for array for now

      if (Object.keys(payload).length > 0) {
        await setDoc(docRef, payload, { merge: true });
        fetchPlaceFromFirebase(mosque.id);
        Alert.alert("Thank you!", "Your edits have been recorded and are pending community consensus.");
      } else {
         Alert.alert("No Changes", "No new suggestions were submitted.");
      }
      
      onClose();
    } catch (error) {
      console.error("Error submitting edits:", error);
      Alert.alert("Error", "Could not submit edits. Please try again.");
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: Platform.OS === 'android' ? insets.top : 0 }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Suggest an Edit</Text>
          <TouchableOpacity onPress={handleSubmit} style={styles.headerBtn}>
            <Text style={styles.submitText}>Submit</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.mosqueName} numberOfLines={1}>{mosque.displayName?.text}</Text>
          <Text style={styles.subtitle}>Help us keep this information accurate.</Text>

          {/* Amenities Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Amenities</Text>
            
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Text style={styles.rowIcon}>🧕</Text>
                <Text style={styles.rowLabel}>Women's Section</Text>
              </View>
              <Switch
                value={formState.hasWomens}
                onValueChange={() => handleToggle('hasWomens')}
                trackColor={{ false: '#e2e8f0', true: '#3b82f6' }}
              />
            </View>

            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="accessibility" size={20} color={theme.primary} style={[styles.rowIcon, {marginRight: 10}]} />
                <Text style={styles.rowLabel}>Wheelchair Accessible</Text>
              </View>
              <Switch
                value={formState.wheelchair}
                onValueChange={() => handleToggle('wheelchair')}
                trackColor={{ false: '#e2e8f0', true: '#3b82f6' }}
              />
            </View>

            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Text style={styles.rowIcon}>💧</Text>
                <Text style={styles.rowLabel}>Wudu Facilities</Text>
              </View>
              <Switch
                value={formState.wudu}
                onValueChange={() => handleToggle('wudu')}
                trackColor={{ false: '#e2e8f0', true: '#3b82f6' }}
              />
            </View>
          </View>

          {/* Jummah Times Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Jummah Times</Text>
            
            {formState.jummahTimes.length > 0 ? (
              formState.jummahTimes.map((time, idx) => (
                <View key={idx} style={styles.timeRow}>
                  <View style={styles.rowLeft}>
                    <MaterialCommunityIcons name="mosque" size={20} color={theme.primary} style={[styles.rowIcon, {marginRight: 10}]} />
                    <Text style={styles.timeText}>{time}</Text>
                  </View>
                  <TouchableOpacity 
                    onPress={() => handleRemoveTime(idx)}
                    style={styles.removeBtn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="close-circle" size={24} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              ))
            ) : (
              <Text style={styles.noDataText}>No Jummah times listed.</Text>
            )}

            <TouchableOpacity style={styles.addBtn} onPress={handleAddTime} activeOpacity={0.7}>
              <Ionicons name="add" size={20} color="#3b82f6" />
              <Text style={styles.addBtnText}>Add Jamaat Time</Text>
            </TouchableOpacity>
          </View>

        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerBtn: {
    paddingVertical: 6,
    paddingHorizontal: 4,
    minWidth: 60,
  },
  cancelText: {
    fontSize: 16,
    color: '#64748b',
    fontWeight: '500',
  },
  submitText: {
    fontSize: 16,
    color: '#3b82f6',
    fontWeight: '700',
    textAlign: 'right',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  content: {
    padding: 24,
    paddingBottom: 60,
  },
  mosqueName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#64748b',
    marginBottom: 24,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  rowIcon: {
    fontSize: 22,
    marginRight: 14,
    width: 28,
    textAlign: 'center',
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#334155',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  timeText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
  },
  removeBtn: {
    padding: 4,
  },
  noDataText: {
    fontSize: 15,
    color: '#94a3b8',
    fontStyle: 'italic',
    marginBottom: 8,
    marginTop: 4,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 8,
  },
  addBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#3b82f6',
    marginLeft: 6,
  },
});

export default SuggestEditModal;
