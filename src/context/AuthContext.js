import React, { createContext, useState, useEffect, useContext } from 'react';
import { 
  onAuthStateChanged, signInAnonymously, signOut,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  EmailAuthProvider, linkWithCredential
} from 'firebase/auth';
import { auth } from '../firebaseConfig';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Soft Gate boolean: is the user fully authenticated (not anonymous)?
  const isLoggedIn = !!user && !user.isAnonymous;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        // Auto-initialize anonymous session so they always have an L2 identity
        try {
          await signInAnonymously(auth);
        } catch (e) {
          console.error("Auto anon login failed", e);
          setLoading(false);
        }
      } else {
        setUser(currentUser);
        setLoading(false);
      }
    });
    
    return unsubscribe;
  }, []);

  const loginWithEmail = async (email, password, isSignUp) => {
    try {
      if (isSignUp) {
        if (user && user.isAnonymous) {
          // Upgrade their anonymous data to a real account
          const credential = EmailAuthProvider.credential(email, password);
          const userCredential = await linkWithCredential(user, credential);
          setUser({ ...userCredential.user }); // Force re-render
          return { success: true };
        } else {
          const userCredential = await createUserWithEmailAndPassword(auth, email, password);
          setUser({ ...userCredential.user });
          return { success: true };
        }
      } else {
        // Standard login
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        setUser({ ...userCredential.user });
        return { success: true };
      }
    } catch (error) {
      console.error('Email Auth Error:', error);
      return { success: false, error: error.message };
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      // The onAuthStateChanged listener will automatically re-assign an anonymous UID.
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoggedIn, loading, loginWithEmail, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
