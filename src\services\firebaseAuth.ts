import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut,
  setPersistence,
  browserSessionPersistence,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// Enforce browserSessionPersistence: la sesión se cierra automáticamente al cerrar la página o pestaña
setPersistence(auth, browserSessionPersistence).catch((err) => {
  console.warn('Could not set auth session persistence:', err);
});

export const db = (firebaseConfig as any).firestoreDatabaseId
  ? getFirestore(app, (firebaseConfig as any).firestoreDatabaseId)
  : getFirestore(app);

// Request Google Workspace scopes for Drive and Spreadsheets
export const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
];

const STORAGE_TOKEN_KEY = 'svh_google_oauth_token';

// Cache for OAuth access token (stored in sessionStorage so it clears automatically on page close)
let cachedAccessToken: string | null =
  typeof window !== 'undefined' ? sessionStorage.getItem(STORAGE_TOKEN_KEY) : null;
let isSigningIn = false;

// Limpiar residuos en localStorage si existían de versiones anteriores
if (typeof window !== 'undefined') {
  localStorage.removeItem(STORAGE_TOKEN_KEY);
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      const token = cachedAccessToken || (typeof window !== 'undefined' ? sessionStorage.getItem(STORAGE_TOKEN_KEY) : null);
      if (token) {
        cachedAccessToken = token;
        if (onAuthSuccess) onAuthSuccess(user, token);
      } else {
        // User is still authenticated in Firebase, keep session open without auto-logging out!
        if (onAuthSuccess) onAuthSuccess(user, '');
      }
    } else {
      if (!isSigningIn) {
        cachedAccessToken = null;
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem(STORAGE_TOKEN_KEY);
          localStorage.removeItem(STORAGE_TOKEN_KEY);
        }
        if (onAuthFailure) onAuthFailure();
      }
    }
  });
};

export const googleSignIn = async (options?: {
  promptSelectAccount?: boolean;
}): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const provider = new GoogleAuthProvider();
    SCOPES.forEach((scope) => provider.addScope(scope));

    if (options?.promptSelectAccount) {
      provider.setCustomParameters({ prompt: 'select_account' });
    }

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('No se pudo obtener el token de acceso de Google.');
    }

    cachedAccessToken = credential.accessToken;
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(STORAGE_TOKEN_KEY, credential.accessToken);
      localStorage.removeItem(STORAGE_TOKEN_KEY);
      window.dispatchEvent(
        new CustomEvent('svh_google_token_refreshed', {
          detail: { token: credential.accessToken, user: result.user },
        })
      );
    }

    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Error al iniciar sesión con Google:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const switchGoogleAccount = async (): Promise<{ user: User; accessToken: string } | null> => {
  return googleSignIn({ promptSelectAccount: true });
};

export const addGoogleAccount = async (): Promise<{ user: User; accessToken: string } | null> => {
  return googleSignIn({ promptSelectAccount: true });
};

export const getAccessToken = async (): Promise<string | null> => {
  if (!cachedAccessToken && typeof window !== 'undefined') {
    cachedAccessToken = sessionStorage.getItem(STORAGE_TOKEN_KEY);
  }
  return cachedAccessToken;
};

export const logout = async () => {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_TOKEN_KEY);
  }
  cachedAccessToken = null;
  await signOut(auth);
};
