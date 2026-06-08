import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { MosqueContext } from '../context/MosqueContext';
import { AuthContext } from '../context/AuthContext';
import { useContext } from 'react';


const questions = [
  { id: 'hasWomens', text: 'Does this mosque have a dedicated women\'s section?' },
  { id: 'wheelchair', text: 'Is there a wheelchair-accessible entrance?' },
  { id: 'wudu', text: 'Are there Wudu facilities available?' },
];

const ContributionFlowModal = ({ visible, onClose, mosque }) => {
  const insets = useSafeAreaInsets();
  const { fetchPlaceFromFirebase } = useContext(MosqueContext);
  const { user } = useContext(AuthContext);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});

  if (!mosque) return null;

  const handleAnswer = (value) => {
    // Save answer
    const currentQ = questions[currentIndex];
    setAnswers((prev) => ({ ...prev, [currentQ.id]: value }));

    // Animate transition
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

    // Advance or complete
    setCurrentIndex((prev) => prev + 1);
  };

  const handleDone = async () => {
    if (mosque?.id && user?.uid && Object.keys(answers).length > 0) {
      try {
        const docRef = doc(db, 'places', mosque.id);
        const snapshot = await getDoc(docRef);
        const currentData = snapshot.exists() ? snapshot.data() : {};
        
        const payload = {};
        
        Object.entries(answers).forEach(([field, newValue]) => {
          if (newValue === 'not_sure') return; // Ignore unsure votes

          if (currentData[field]?.value === newValue) return; // Already true globally
          
          const pendingObj = currentData[`pending_${field}`] || {};
          const stringifiedVal = String(newValue);
          const existingPending = pendingObj[stringifiedVal];

          if (existingPending) {
             if (existingPending.voted_by?.includes(user.uid)) return; // Already voted for this specifically
             
             const newVotes = (existingPending.votes || 0) + 1;
             const newVoters = [...(existingPending.voted_by || []), user.uid];

             if (newVotes >= 3) {
               payload[field] = { value: newValue, confirmations: 3, voted_by: newVoters };
               payload[`pending_${field}`] = {}; 
             } else {
               pendingObj[stringifiedVal] = { votes: newVotes, voted_by: newVoters };
               payload[`pending_${field}`] = pendingObj;
             }
          } else {
             pendingObj[stringifiedVal] = { votes: 1, voted_by: [user.uid] };
             payload[`pending_${field}`] = pendingObj;
          }
        });

        if (Object.keys(payload).length > 0) {
          await setDoc(docRef, payload, { merge: true });
          fetchPlaceFromFirebase(mosque.id);
        }
      } catch (error) {
        console.error("Error submitting answers:", error);
      }
    }
    
    // Reset state and close
    setCurrentIndex(0);
    setAnswers({});
    onClose();
  };

  const renderProgress = () => {
    const progressText = `Question ${currentIndex + 1} of ${questions.length}`;
    const progressPercent = ((currentIndex) / questions.length) * 100;

    return (
      <View style={styles.progressContainer}>
        <Text style={styles.progressText}>{progressText}</Text>
        <View style={styles.progressBarBackground}>
          <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
        </View>
      </View>
    );
  };

  const renderQuestionCard = () => {
    const question = questions[currentIndex];
    return (
      <View style={styles.card}>
        <Text style={styles.questionText}>{question.text}</Text>
      </View>
    );
  };

  const renderActions = () => {
    return (
      <View style={styles.actionContainer}>
        <TouchableOpacity 
          style={[styles.answerBtn, styles.btnYes]} 
          onPress={() => handleAnswer(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.btnTextYes}>Yes</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.answerBtn, styles.btnNo]} 
          onPress={() => handleAnswer(false)}
          activeOpacity={0.8}
        >
          <Text style={styles.btnTextNo}>No</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.answerBtn, styles.btnNotSure]} 
          onPress={() => handleAnswer('not_sure')}
          activeOpacity={0.8}
        >
          <Text style={styles.btnTextNotSure}>Not Sure</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderSuccess = () => {
    return (
      <View style={styles.successContainer}>
        <View style={styles.successIconCircle}>
          <Ionicons name="checkmark" size={60} color="#fff" />
        </View>
        <Text style={styles.successTitle}>Thank You!</Text>
        <Text style={styles.successSubtitle}>
          Your answers help the community find accurate mosque information.
        </Text>
        <TouchableOpacity style={styles.doneBtn} onPress={handleDone} activeOpacity={0.8}>
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const isComplete = currentIndex >= questions.length;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity 
            onPress={isComplete ? handleDone : onClose} 
            style={styles.closeBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={28} color="#334155" />
          </TouchableOpacity>
        </View>

        {!isComplete && renderProgress()}

        <View style={styles.content}>
          {!isComplete ? (
            <>
              {renderQuestionCard()}
              {renderActions()}
            </>
          ) : (
            renderSuccess()
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 10,
    alignItems: 'flex-end',
  },
  closeBtn: {
    padding: 4,
  },
  progressContainer: {
    paddingHorizontal: 24,
    marginBottom: 40,
    alignItems: 'center',
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  progressBarBackground: {
    height: 6,
    width: '100%',
    backgroundColor: '#e2e8f0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#3b82f6', // blue-500
    borderRadius: 3,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80, // Offset a bit from bottom
  },
  card: {
    backgroundColor: '#fff',
    width: '100%',
    paddingVertical: 60,
    paddingHorizontal: 30,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
    minHeight: 280,
  },
  questionText: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
    lineHeight: 36,
  },
  actionContainer: {
    width: '100%',
    gap: 16,
  },
  answerBtn: {
    width: '100%',
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  btnYes: {
    backgroundColor: '#eff6ff', // blue-50
    borderColor: '#3b82f6', // blue-500
  },
  btnTextYes: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2563eb', // blue-600
  },
  btnNo: {
    backgroundColor: '#fff',
    borderColor: '#e2e8f0',
  },
  btnTextNo: {
    fontSize: 18,
    fontWeight: '700',
    color: '#475569',
  },
  btnNotSure: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    paddingVertical: 12,
  },
  btnTextNotSure: {
    fontSize: 16,
    fontWeight: '600',
    color: '#94a3b8',
  },
  
  // Success state
  successContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  successIconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#10b981', // emerald-500
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  successTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 16,
  },
  successSubtitle: {
    fontSize: 18,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 48,
    lineHeight: 28,
    paddingHorizontal: 20,
  },
  doneBtn: {
    backgroundColor: '#0f172a', // slate-900
    width: '100%',
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
  },
  doneBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
});

export default ContributionFlowModal;
