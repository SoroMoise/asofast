/**
 * Minimal typings for Google Identity Services (One Tap / FedCM).
 * Loaded at runtime from https://accounts.google.com/gsi/client.
 * Covers only the surface we use; extend if you adopt more of the API.
 */
interface GoogleCredentialResponse {
  /** JWT ID token to hand to supabase.auth.signInWithIdToken. */
  credential: string;
  select_by?: string;
}

interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  /** SHA-256 hashed nonce (hex). Raw nonce goes to Supabase. */
  nonce?: string;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  use_fedcm_for_prompt?: boolean;
  context?: "signin" | "signup" | "use";
}

interface GoogleAccountsId {
  initialize: (config: GoogleIdConfiguration) => void;
  prompt: () => void;
  cancel: () => void;
}

interface Window {
  google?: {
    accounts: {
      id: GoogleAccountsId;
    };
  };
}
