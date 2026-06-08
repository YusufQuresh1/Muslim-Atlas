import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
  Switch
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import LoginModal from './LoginModal';

const SUPPORT_URL = 'https://buymeacoffee.com/mosquemap'; // Placeholder

const SettingsScreen = () => {
  const insets = useSafeAreaInsets();
  const { user, isLoggedIn, logout } = useAuth();
  const { theme, themeMode, setTheme } = useTheme();
  const [showLoginModal, setShowLoginModal] = useState(false);

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

        <View style={styles.content}>
          {/* Auth Section */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.subText }]}>Account</Text>
            
            <View style={[styles.authCard, { backgroundColor: theme.card }]}>
              <View style={styles.authInfoRow}>
                <View style={[styles.avatarCircle, !isLoggedIn && { backgroundColor: theme.chipBg }]}>
                  <Ionicons name={isLoggedIn ? "person" : "incognito"} size={24} color={isLoggedIn ? theme.tint : theme.subText} />
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

          {/* Support Section */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.subText }]}>Support the App</Text>
            <View style={[styles.supportCard, { backgroundColor: theme.card }]}>
              <Text style={[styles.supportDesc, { color: theme.text }]}>
                Mosque Map relies on expensive server APIs to keep data accurate. If you find this app helpful, consider chipping in for a coffee!
              </Text>
              <TouchableOpacity style={[styles.supportBtn, { backgroundColor: theme.primary }]} onPress={handleSupport}>
                <Text style={styles.supportBtnIcon}>☕</Text>
                <Text style={styles.supportBtnText}>Support the Server Costs</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Optional: App Info / Version */}
          <View style={styles.footerInfo}>
             <Text style={[styles.versionText, { color: theme.subText }]}>Mosque Map v1.0.0</Text>
          </View>

        </View>
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
    marginTop: 'auto',
    alignItems: 'center',
    paddingVertical: 20,
  },
  versionText: {
    fontSize: 14,
    fontWeight: '500',
  }
});

export default SettingsScreen;
