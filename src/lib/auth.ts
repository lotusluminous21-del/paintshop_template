import { 
    GoogleAuthProvider, 
    signInWithPopup, 
    signInWithRedirect,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInAnonymously as firebaseSignInAnonymously,
    User 
} from 'firebase/auth';
import { auth } from './firebase';

const googleProvider = new GoogleAuthProvider();

export async function signInWithGoogle(): Promise<User | null> {
    if (!auth) {
        throw new Error('Firebase Auth is not initialized. Check your configuration.');
    }

    try {
        const result = await signInWithPopup(auth, googleProvider);
        return result.user;
    } catch (error) {
        console.error('Error signing in with Google', error);
        throw error;
    }
}

export async function signUpWithEmail(email: string, password: string): Promise<User | null> {
    if (!auth) {
        throw new Error('Firebase Auth is not initialized. Check your configuration.');
    }

    try {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        return result.user;
    } catch (error) {
        console.error('Error signing up with Email', error);
        throw error;
    }
}

export async function signInWithEmail(email: string, password: string): Promise<User | null> {
    if (!auth) {
        throw new Error('Firebase Auth is not initialized. Check your configuration.');
    }

    try {
        const result = await signInWithEmailAndPassword(auth, email, password);
        return result.user;
    } catch (error) {
        console.error('Error signing in with Email', error);
        throw error;
    }
}

export async function signInAnonymously(): Promise<User | null> {
    if (!auth) {
        throw new Error('Firebase Auth is not initialized. Check your configuration.');
    }

    try {
        const result = await firebaseSignInAnonymously(auth);
        return result.user;
    } catch (error) {
        console.error('Error signing in anonymously', error);
        throw error;
    }
}

export async function signOutUser(): Promise<void> {
    if (!auth) return;
    try {
        await auth.signOut();
    } catch (error) {
        console.error('Error signing out', error);
    }
}
