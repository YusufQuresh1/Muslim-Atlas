import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
  Switch,
  ScrollView
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { usePrayerSettings } from '../context/PrayerSettingsContext';
import LoginModal from './LoginModal';

const SUPPORT_URL = 'https://buymeacoffee.com/mosquemap'; // Placeholder

const CALC_METHODS = [
  { label: 'London Unified (UK)', value: 'LondonUnified' },
  { label: 'Muslim World League', value: 'MuslimWorldLeague' },
  { label: 'Egyptian General Authority', value: 'Egyptian' },
  { label: 'Karachi (UISK)', value: 'Karachi' },
  { label: 'Umm Al-Qura (Makkah)', value: 'UmmAlQura' },
  { label: 'North America (ISNA)', value: 'NorthAmerica' },
  { label: 'Moonsighting Committee', value: 'MoonsightingCommittee' },
  { label: 'Diyanet (Turkey)', value: 'Turkey' },
  { label: 'Dubai', value: 'Dubai' },
  { label: 'Singapore', value: 'Singapore' },
  { label: 'Tehran', value: 'Tehran' },
];

const HIGH_LAT_RULES = [
  { label: 'Auto (Recommended)', value: 'Auto' },
  { label: 'Seventh of the Night', value: 'SeventhOfTheNight' },
  { label: 'Twilight Angle Method', value: 'TwilightAngle' },
  { label: 'Middle of the Night', value: 'MiddleOfTheNight' },
  { label: 'No Adjustment', value: 'None' },
];

const SettingsScreen = () => {
  const insets = useSafeAreaInsets();
  const { user, isLoggedIn, logout } = useAuth();
  const { theme, themeMode, setTheme } = useTheme();
  const { 
    asrMethod, 
    setAsrMethod, 
    prayerOffsets, 
    updatePrayerOffset,
    calculationMethod,
    setCalculationMethod,
    highLatitudeRule,
    setHighLatitudeRule
  } = usePrayerSettings();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [methodExpanded, setMethodExpanded] = useState(false);
  const [ruleExpanded, setRuleExpanded] = useState(false);

  const handleSupport = async () => {
    try {
      const supported = await Linking.canOpenURL(SUPPORT_URL);
      if (supported) {
        await Linking.openURL(SUPPORT_URL);
      } else {
        Alert.alert("Error", "Don't know how to open this URL");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSignOut = async () => {
    Alert.alert(
      "Sign Out",
      "Are you sure you want to sign out?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Sign Out", 
          style: "destructive",
          onPress: async () => {
            await logout();
            // Assuming we don't need to explicitly close the modal here,
            // as they may just want to see the state revert to Anonymous.
            // But we could trigger onClose() if desired.
          }
        }
      ]
    );
  };

  return (
    <>
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: theme.background }]}>
        <View style={[styles.header, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Settings & Profile</Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {/* Auth Section */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.subText }]}>Account</Text>
            
            <View style={[styles.authCard, { backgroundColor: theme.card }]}>
              <View style={styles.authInfoRow}>
                <View style={[styles.avatarCircle, !isLoggedIn && { backgroundColor: theme.chipBg }]}>
                  <Ionicons name={isLoggedIn ? "person" : "eye-off-outline"} size={24} color={isLoggedIn ? theme.tint : theme.subText} />
                </View>
                <View style={styles.authTextContainer}>
                  <Text style={[styles.authStatusText, { color: theme.text }]}>
                    {isLoggedIn ? 'Logged In' : 'Browsing Anonymously'}
                  </Text>
                  {isLoggedIn && user?.email && (
                    <Text style={[styles.authEmailText, { color: theme.subText }]}>{user.email}</Text>
                  )}
                  {!isLoggedIn && (
                    <Text style={[styles.authDescText, { color: theme.subText }]}>
                      Sign in to contribute edits and help the community.
                    </Text>
                  )}
                </View>
              </View>

              {isLoggedIn ? (
                <TouchableOpacity style={[styles.signOutBtn, { borderColor: theme.danger }]} onPress={handleSignOut}>
                  <Text style={[styles.signOutBtnText, { color: theme.danger }]}>Sign Out</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.signInBtn, { backgroundColor: theme.tint }]} onPress={() => setShowLoginModal(true)}>
                  <Text style={styles.signInBtnText}>Join the Community</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Appearance Section */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.subText }]}>Appearance</Text>
            <View style={[styles.authCard, { backgroundColor: theme.card, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name={theme.mode === 'dark' ? "moon" : "sunny"} size={22} color={theme.text} style={{ marginRight: 12 }} />
                <Text style={[styles.authStatusText, { color: theme.text, marginBottom: 0 }]}>Dark Mode</Text>
              </View>
              <Switch
                value={themeMode === 'dark'}
                onValueChange={(val) => setTheme(val ? 'dark' : 'light')}
                trackColor={{ false: '#767577', true: theme.primary }}
                thumbColor={'#fff'}
              />
            </View>
          </View>

          {/* Prayer Calculation Settings Section */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.subText }]}>Prayer Calculations</Text>
            
            {/* Calculation Method Selection */}
            <View style={[styles.authCard, { backgroundColor: theme.card, marginBottom: 16 }]}>
              <TouchableOpacity 
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                onPress={() => setMethodExpanded(!methodExpanded)}
              >
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.authStatusText, { color: theme.text, marginBottom: 4, fontSize: 16 }]}>Calculation Method</Text>
                  <Text style={[styles.authDescText, { color: theme.subText, fontSize: 12 }]}>
                    {CALC_METHODS.find(m => m.value === calculationMethod)?.label || calculationMethod}
                  </Text>
                </View>
                <Ionicons name={methodExpanded ? "chevron-up" : "chevron-down"} size={20} color={theme.text} />
              </TouchableOpacity>
              
              {methodExpanded && (
                <View style={{ marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingTop: 8 }}>
                  {CALC_METHODS.map((m) => (
                    <TouchableOpacity
                      key={m.value}
                      style={[styles.methodOption, calculationMethod === m.value && { backgroundColor: theme.chipBg }]}
                      onPress={() => {
                        setCalculationMethod(m.value);
                        setMethodExpanded(false);
                      }}
                    >
                      <Text style={[styles.methodOptionText, { color: theme.text }, calculationMethod === m.value && { fontWeight: '700', color: theme.primary }]}>
                        {m.label}
                      </Text>
                      {calculationMethod === m.value && (
                        <Ionicons name="checkmark" size={16} color={theme.primary} />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* High Latitude Rule Selection */}
            <View style={[styles.authCard, { backgroundColor: theme.card, marginBottom: 16 }]}>
              <TouchableOpacity 
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                onPress={() => setRuleExpanded(!ruleExpanded)}
              >
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.authStatusText, { color: theme.text, marginBottom: 4, fontSize: 16 }]}>High Latitude Adjustment</Text>
                  <Text style={[styles.authDescText, { color: theme.subText, fontSize: 12 }]}>
                    {HIGH_LAT_RULES.find(r => r.value === highLatitudeRule)?.label || highLatitudeRule}
                  </Text>
                </View>
                <Ionicons name={ruleExpanded ? "chevron-up" : "chevron-down"} size={20} color={theme.text} />
              </TouchableOpacity>
              
              {ruleExpanded && (
                <View style={{ marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingTop: 8 }}>
                  {HIGH_LAT_RULES.map((r) => (
                    <TouchableOpacity
                      key={r.value}
                      style={[styles.methodOption, highLatitudeRule === r.value && { backgroundColor: theme.chipBg }]}
                      onPress={() => {
                        setHighLatitudeRule(r.value);
                        setRuleExpanded(false);
                      }}
                    >
                      <Text style={[styles.methodOptionText, { color: theme.text }, highLatitudeRule === r.value && { fontWeight: '700', color: theme.primary }]}>
                        {r.label}
                      </Text>
                      {highLatitudeRule === r.value && (
                        <Ionicons name="checkmark" size={16} color={theme.primary} />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <View style={[styles.authCard, { backgroundColor: theme.card, marginBottom: 16 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.authStatusText, { color: theme.text, marginBottom: 4, fontSize: 16 }]}>Hanafi Asr Method</Text>
                  <Text style={[styles.authDescText, { color: theme.subText, fontSize: 12 }]}>Use shadow length 2 for Asr calculations</Text>
                </View>
                <Switch
                  value={asrMethod === 'hanafi'}
                  onValueChange={(val) => setAsrMethod(val ? 'hanafi' : 'standard')}
                  trackColor={{ false: '#767577', true: theme.primary }}
                  thumbColor={'#fff'}
                />
              </View>
            </View>

            <Text style={[styles.sectionTitle, { color: theme.subText, fontSize: 13, marginBottom: 8 }]}>Manual Minute Offsets</Text>
            <View style={[styles.authCard, { backgroundColor: theme.card, paddingVertical: 10 }]}>
              {['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map((prayerName) => {
                const val = prayerOffsets[prayerName] || 0;
                return (
                  <View key={prayerName} style={[styles.offsetRow, { borderBottomColor: theme.border }]}>
                    <Text style={[styles.offsetLabel, { color: theme.text }]}>{prayerName}</Text>
                    <View style={styles.counterContainer}>
                      <TouchableOpacity 
                        style={[styles.counterBtn, { backgroundColor: theme.chipBg }]} 
                        onPress={() => updatePrayerOffset(prayerName, val - 1)}
                      >
                        <Ionicons name="remove" size={16} color={theme.text} />
                      </TouchableOpacity>
                      <Text style={[styles.counterVal, { color: theme.text }]}>
                        {val > 0 ? `+${val}` : val}m
                      </Text>
                      <TouchableOpacity 
                        style={[styles.counterBtn, { backgroundColor: theme.chipBg }]} 
                        onPress={() => updatePrayerOffset(prayerName, val + 1)}
                      >
                        <Ionicons name="add" size={16} color={theme.text} />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Support Section */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.subText }]}>Support the App</Text>
            <View style={[styles.supportCard, { backgroundColor: theme.card }]}>
              <Text style={[styles.supportDesc, { color: theme.text }]}>
                Muslim Atlas relies on server APIs and location databases to keep data accurate. If you find this app helpful, consider supporting!
              </Text>
              <TouchableOpacity style={[styles.supportBtn, { backgroundColor: theme.primary }]} onPress={handleSupport}>
                <Text style={styles.supportBtnIcon}>☕</Text>
                <Text style={styles.supportBtnText}>Support Server Costs</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* App Info / Version */}
          <View style={styles.footerInfo}>
             <Text style={[styles.versionText, { color: theme.subText }]}>Muslim Atlas v1.0.0</Text>
          </View>
        </ScrollView>
      </View>

      <LoginModal 
        visible={showLoginModal} 
        onClose={() => setShowLoginModal(false)} 
      />
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
  },
  content: {
    padding: 20,
    flex: 1,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  authCard: {
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  authInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  authTextContainer: {
    flex: 1,
  },
  authStatusText: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  authEmailText: {
    fontSize: 15,
    fontWeight: '500',
  },
  authDescText: {
    fontSize: 14,
    lineHeight: 20,
  },
  signInBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  signInBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  signOutBtn: {
    backgroundColor: 'transparent', // controlled by theme
    borderWidth: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  signOutBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  supportCard: {
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  supportDesc: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 20,
  },
  supportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
  },
  supportBtnIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  supportBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  footerInfo: {
    marginTop: 30,
    alignItems: 'center',
    paddingVertical: 20,
  },
  versionText: {
    fontSize: 14,
    fontWeight: '500',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  offsetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  offsetLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  counterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  counterBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  counterVal: {
    fontSize: 15,
    fontWeight: '700',
    minWidth: 40,
    textAlign: 'center',
  },
  methodOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginVertical: 2,
  },
  methodOptionText: {
    fontSize: 14,
  },
});

export default SettingsScreen;
