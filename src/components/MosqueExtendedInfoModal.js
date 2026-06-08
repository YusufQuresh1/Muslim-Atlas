import React, { useState, useEffect, useContext } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { MosqueContext } from '../context/MosqueContext';
import { useAuth } from '../context/AuthContext';
import LoginModal from './LoginModal';
import ContributionFlowModal from './ContributionFlowModal';
import SuggestEditModal from './SuggestEditModal';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

const MosqueExtendedInfoModal = ({ visible, onClose, mosque, crowdsourcedData }) => {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { user, isLoggedIn } = useAuth();
  const { fetchPlaceFromFirebase } = useContext(MosqueContext);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showContributionFlow, setShowContributionFlow] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // 'questions' | 'edit' | null

  // Auto-open previously clicked action once user finishes logging in
  useEffect(() => {
    if (isLoggedIn && pendingAction) {
      if (pendingAction === 'questions') {
        setShowContributionFlow(true);
      } else if (pendingAction === 'edit') {
        setShowEditForm(true);
      }
      setPendingAction(null);
    }
  }, [isLoggedIn, pendingAction]);
  
  if (!mosque) return null;

  const handleConfirm = async (fieldKey, currentValue) => {
    if (!isLoggedIn) {
      setPendingAction('questions'); // we'll just prompt login
      setShowLoginModal(true);
      return;
    }
    
    try {
      const docRef = doc(db, 'places', mosque.id);
      const snapshot = await getDoc(docRef);
      const currentData = snapshot.exists() ? snapshot.data() : {};
      
      const payload = {};
      const fieldData = currentData[fieldKey] || {};
      const votedBy = fieldData.voted_by || [];
      const confirmations = fieldData.confirmations || 1; // Assuming implicit 1 vote if it exists
      
      if (votedBy.includes(user.uid)) return; // Already voted logic handled by UI anyway, but safety check

      payload[fieldKey] = {
        value: currentValue,
        confirmations: confirmations + 1,
        voted_by: [...votedBy, user.uid]
      };
      
      await setDoc(docRef, payload, { merge: true });
      fetchPlaceFromFirebase(mosque.id);
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Could not confirm data.");
    }
  };

  const renderTrustScore = (fieldKey, booleanValue) => {
    const fieldObj = crowdsourcedData?.[fieldKey];
    const isAvailable = booleanValue;
    
    // Standard direct values from before Phase 13 might not be objects
    let confirmations = 1;
    let hasVoted = false;

    if (fieldObj && typeof fieldObj === 'object' && fieldObj.value !== undefined) {
      confirmations = fieldObj.confirmations || 1;
      hasVoted = fieldObj.voted_by?.includes(user?.uid);
    } else if (fieldObj !== undefined) {
       // Legacy value mapping
       confirmations = 1;
    } else {
       // No value exists
       return null;
    }

    return (
      <View style={styles.trustScoreRow}>
        <Text style={[styles.amenityValue, isAvailable ? styles.valueYes : styles.valueNo]}>
          {isAvailable ? 'Available' : 'Not Available'}
        </Text>
        <Text style={styles.trustScoreText}> • Confirmed by {confirmations}</Text>
        <TouchableOpacity 
          style={[styles.confirmBtn, hasVoted && styles.confirmBtnDisabled]} 
          onPress={() => handleConfirm(fieldKey, isAvailable)}
          disabled={hasVoted}
        >
          <Text style={[styles.confirmBtnText, hasVoted && styles.confirmBtnTextDisabled]}><Ionicons name="thumbs-up-outline" size={14} color={hasVoted ? "#9CA3AF" : "#fff"} /> Confirm</Text>
        </TouchableOpacity>
      </View>
    );
  };
  
  // Helper to safely extract boolean value whether it's an object or legacy literal
  const getFieldValue = (fieldKey) => {
    const field = crowdsourcedData?.[fieldKey];
    if (field && typeof field === 'object' && field.value !== undefined) return field.value;
    return !!field;
  };

  const handleAnswerQuestions = () => {
    if (!isLoggedIn) {
      setPendingAction('questions');
      setShowLoginModal(true);
    } else {
      setShowContributionFlow(true);
    }
  };

  const handleSuggestEdit = () => {
    if (!isLoggedIn) {
      setPendingAction('edit');
      setShowLoginModal(true);
    } else {
      setShowEditForm(true);
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
        <View style={styles.header}>
          <Text style={styles.headerTitle} numberOfLines={1}>{mosque.displayName?.text} Info</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Amenities</Text>
            
            <View style={styles.amenityRow}>
               <MaterialCommunityIcons name="human-male-female" size={24} color={theme.text} style={styles.amenityIcon} />
              <View style={styles.amenityTextContainer}>
                <Text style={styles.amenityLabel}>Women's Section</Text>
                {renderTrustScore('hasWomens', getFieldValue('hasWomens'))}
              </View>
            </View>

            <View style={styles.amenityRow}>
               <Ionicons name="accessibility-outline" size={24} color={theme.text} style={styles.amenityIcon} />
              <View style={styles.amenityTextContainer}>
                <Text style={styles.amenityLabel}>Wheelchair Accessible</Text>
                {renderTrustScore('wheelchair', getFieldValue('wheelchair'))}
              </View>
            </View>

            <View style={styles.amenityRow}>
                <MaterialCommunityIcons name="water-outline" size={24} color={theme.text} style={styles.amenityIcon} />
              <View style={styles.amenityTextContainer}>
                <Text style={styles.amenityLabel}>Wudu Facilities</Text>
                {renderTrustScore('wudu', getFieldValue('wudu'))}
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Jummah Times</Text>
            {crowdsourcedData?.jummahTimes?.length > 0 ? (
              crowdsourcedData.jummahTimes.map((time, idx) => (
                <View key={idx} style={styles.timeRow}>
                  <MaterialCommunityIcons name="mosque" size={20} color={theme.text} style={styles.timeIcon} />
                  <Text style={styles.timeText}>{time}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.noDataText}>No Jummah times available</Text>
            )}
          </View>

          <View style={styles.ctaContainer}>
            <View style={styles.ctaMainBlock}>
              <Text style={styles.ctaSubtitle}>Know this place? Help the community by filling in missing info.</Text>
              <TouchableOpacity style={styles.ctaButton} onPress={handleAnswerQuestions} activeOpacity={0.8}>
                <Text style={styles.ctaButtonText}>Answer quick questions</Text>
              </TouchableOpacity>
            </View>
            
            <TouchableOpacity onPress={handleSuggestEdit} style={styles.secondaryCtaBtn} activeOpacity={0.6}>
              <Text style={styles.secondaryCtaText}>Spot an error? Suggest an edit.</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
      
      <LoginModal 
        visible={showLoginModal} 
        onClose={() => setShowLoginModal(false)} 
      />

      <ContributionFlowModal 
        visible={showContributionFlow}
        onClose={() => setShowContributionFlow(false)}
        mosque={mosque}
      />

      <SuggestEditModal
        visible={showEditForm}
        onClose={() => setShowEditForm(false)}
        mosque={mosque}
        initialData={crowdsourcedData}
      />
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    backgroundColor: '#fff',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  closeBtnText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#334155',
  },
  content: {
    padding: 24,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 32,
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 16,
    letterSpacing: -0.3,
  },
  amenityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  amenityIcon: {
    marginRight: 16,
    width: 32,
    textAlign: 'center',
  },
  amenityTextContainer: {
    flex: 1,
  },
  amenityLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 2,
  },
  amenityValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  trustScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 2,
    gap: 4,
  },
  trustScoreText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  confirmBtn: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    marginLeft: 'auto',
  },
  confirmBtnDisabled: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  confirmBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
  },
  confirmBtnTextDisabled: {
    color: '#94a3b8',
  },
  valueYes: {
    color: '#10b981',
  },
  valueNo: {
    color: '#ef4444',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  timeIcon: {
    marginRight: 16,
    width: 32,
    textAlign: 'center',
  },
  timeText: {
    fontSize: 16,
    color: '#334155',
    fontWeight: '600',
  },
  noDataText: {
    fontSize: 15,
    color: '#64748b',
    fontStyle: 'italic',
  },
  ctaContainer: {
    marginTop: 10,
    alignItems: 'center',
    paddingVertical: 24,
  },
  ctaMainBlock: {
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 24,
    borderRadius: 20,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
    marginBottom: 24,
  },
  ctaSubtitle: {
    fontSize: 16,
    color: '#475569',
    marginBottom: 20,
    textAlign: 'center',
    fontWeight: '500',
    lineHeight: 24,
  },
  ctaButton: {
    backgroundColor: '#3b82f6',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryCtaBtn: {
    paddingVertical: 12,
  },
  secondaryCtaText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});

export default MosqueExtendedInfoModal;
