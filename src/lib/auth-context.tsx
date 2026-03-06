'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, onSnapshot, getFirestore } from 'firebase/firestore';
import { auth, app, db } from './firebase'; // Ensure these are exported from lib/firebase
// Note: We previously checked lib/firebase and it exports 'auth' and 'db'.

interface UserProfile {
    uid: string;
    email: string;
    role: 'admin' | 'customer';
    preferences?: any;
}

interface AuthContextType {
    user: User | null;
    profile: UserProfile | null;
    loading: boolean;
    isAdmin: boolean;
    isAnonymous: boolean;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    profile: null,
    loading: true,
    isAdmin: false,
    isAnonymous: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!auth) {
            setLoading(false);
            return;
        }

        const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
            // Purge legacy anonymous sessions since they are no longer supported
            if (currentUser?.isAnonymous) {
                console.log("Purging legacy anonymous session...");
                if (auth) await signOut(auth);
                return;
            }

            setUser(currentUser);

            if (currentUser) {
                // Set cookie for middleware
                document.cookie = "firebase-auth-token=true; path=/; max-age=2592000; samesite=strict"; // 30 days

                // Subscribe to User Profile in Firestore to get Role
                const firestore = getFirestore(app);
                const userDocRef = doc(firestore, 'users', currentUser.uid);

                const unsubscribeFirestore = onSnapshot(userDocRef, (docSnap) => {
                    if (docSnap.exists()) {
                        setProfile(docSnap.data() as UserProfile);
                    } else {
                        setProfile(null);
                    }
                    setLoading(false);
                }, (error) => {
                    console.error("Auth Profile Error:", error);
                    setLoading(false);
                });

                return () => unsubscribeFirestore();
            } else {
                // Remove cookie
                document.cookie = "firebase-auth-token=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT";

                setProfile(null);
                setLoading(false);
            }
        });


        return () => unsubscribeAuth();
    }, []);

    const isAdmin = profile?.role === 'admin';
    const isAnonymous = user?.isAnonymous ?? false;

    return (
        <AuthContext.Provider value={{ user, profile, loading, isAdmin, isAnonymous }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
