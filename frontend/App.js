import { StatusBar } from 'expo-status-bar';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useState } from 'react';

import api from './src/api';
import MainMap from './src/screens/MainMap';

const theme = {
  bg: '#070313',
  panel: '#130a29',
  panelBorder: '#4c1d95',
  textPrimary: '#f5f3ff',
  textSecondary: '#c4b5fd',
  accent: '#8b5cf6',
  accentPressed: '#7c3aed',
  inputBg: '#140b2b',
  inputBorder: '#5b21b6',
  danger: '#fb7185',
};

function parseError(error) {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => d?.msg || JSON.stringify(d)).join('; ');
  }
  return detail || error?.message || 'Request failed';
}

export default function App() {
  const [mode, setMode] = useState('register');
  const [form, setForm] = useState({
    username: '',
    email: '',
    login: '',
    password: '',
    confirmPassword: '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [token, setToken] = useState('');
  const [guestMode, setGuestMode] = useState(false);

  const onChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetMessages = () => {
    setError('');
    setSuccess('');
  };

  const enterGuestMode = () => {
    setGuestMode(true);
    setSuccess('Guest mode enabled. Auth-only endpoints may be unavailable.');
    setError('');
  };

  const submitAuth = async () => {
    resetMessages();

    if (mode === 'register' && form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      if (mode === 'register') {
        const response = await api.post('/api/auth/register', {
          username: form.username,
          email: form.email,
          password: form.password,
          confirmPassword: form.confirmPassword,
        });

        setSuccess(`User ${response.data?.username || 'created'} created. Please sign in.`);
        setMode('login');
        setForm((prev) => ({
          ...prev,
          login: prev.email,
          password: '',
          confirmPassword: '',
        }));
      } else {
        const response = await api.post('/api/auth/login', {
          login: form.login,
          password: form.password,
        });

        const nextToken = response.data?.access_token || '';
        if (!nextToken) throw new Error('Token was not returned by backend');

        setToken(nextToken);
        setGuestMode(false);
        setSuccess(`Welcome, ${response.data?.user?.username || 'user'}`);
      }
    } catch (e) {
      setError(parseError(e));
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setToken('');
    setGuestMode(false);
    setMode('login');
    setForm((prev) => ({ ...prev, password: '', confirmPassword: '' }));
    setError('');
    setSuccess('');
  };

  if (token || guestMode) {
    return (
      <SafeAreaView style={styles.safeAreaFull}>
        <StatusBar style="light" />
        <MainMap token={token} isGuest={guestMode} onLogout={logout} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.bgDecorTop} />
      <View style={styles.bgDecorBottom} />

      <Pressable style={styles.skipSideButton} onPress={enterGuestMode}>
        <Text style={styles.skipSideText}>Skip auth</Text>
      </Pressable>

      <KeyboardAvoidingView
        style={styles.keyboardArea}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.kicker}>HOG MAPS</Text>
            <Text style={styles.title}>{mode === 'register' ? 'Create account' : 'Sign in'}</Text>
            <Text style={styles.subtitle}>Dark mode control center opens after login.</Text>

            {mode === 'register' ? (
              <>
                <FormField
                  label="Nickname"
                  placeholder="your name"
                  value={form.username}
                  onChangeText={(v) => onChange('username', v)}
                  autoCapitalize="none"
                />
                <FormField
                  label="Email"
                  placeholder="yourmail@example.com"
                  value={form.email}
                  onChangeText={(v) => onChange('email', v)}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <FormField
                  label="Password"
                  placeholder="At least 8 characters"
                  value={form.password}
                  onChangeText={(v) => onChange('password', v)}
                  secureTextEntry
                />
                <FormField
                  label="Confirm password"
                  placeholder="Repeat password"
                  value={form.confirmPassword}
                  onChangeText={(v) => onChange('confirmPassword', v)}
                  secureTextEntry
                />
              </>
            ) : (
              <>
                <FormField
                  label="Login"
                  placeholder="username or email"
                  value={form.login}
                  onChangeText={(v) => onChange('login', v)}
                  autoCapitalize="none"
                />
                <FormField
                  label="Password"
                  placeholder="Your password"
                  value={form.password}
                  onChangeText={(v) => onChange('password', v)}
                  secureTextEntry
                />
              </>
            )}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {success ? <Text style={styles.successText}>{success}</Text> : null}

            <Pressable
              onPress={submitAuth}
              disabled={loading}
              style={({ pressed }) => [
                styles.submitButton,
                (pressed || loading) && styles.submitButtonPressed,
              ]}
            >
              <Text style={styles.submitButtonText}>
                {loading ? 'Please wait...' : mode === 'register' ? 'Sign up' : 'Sign in'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                resetMessages();
                setMode((prev) => (prev === 'register' ? 'login' : 'register'));
              }}
            >
              <Text style={styles.footerText}>
                {mode === 'register' ? 'Already have an account? ' : 'No account yet? '}
                <Text style={styles.linkText}>{mode === 'register' ? 'Sign in' : 'Create one'}</Text>
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FormField({ label, ...inputProps }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...inputProps}
        style={styles.input}
        placeholderTextColor={theme.textSecondary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.bg },
  safeAreaFull: { flex: 1, backgroundColor: '#070313' },
  keyboardArea: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 24,
  },
  bgDecorTop: {
    position: 'absolute',
    top: -80,
    right: -40,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#4c1d95',
    opacity: 0.42,
  },
  bgDecorBottom: {
    position: 'absolute',
    bottom: -120,
    left: -60,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#7e22ce',
    opacity: 0.25,
  },
  skipSideButton: {
    position: 'absolute',
    right: 10,
    top: Platform.OS === 'web' ? '40%' : 220,
    zIndex: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#7e22ce',
    backgroundColor: '#2a1450',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  skipSideText: {
    color: '#f5f3ff',
    fontWeight: '800',
    fontSize: 12,
  },
  card: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.panelBorder,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 22,
  },
  kicker: {
    color: '#c4b5fd',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  title: {
    color: theme.textPrimary,
    fontSize: 30,
    fontWeight: '800',
  },
  subtitle: {
    color: theme.textSecondary,
    fontSize: 14,
    marginTop: 8,
    marginBottom: 20,
    lineHeight: 20,
  },
  fieldWrap: { marginBottom: 12 },
  fieldLabel: {
    color: theme.textSecondary,
    fontSize: 12,
    marginBottom: 7,
    letterSpacing: 0.4,
  },
  input: {
    backgroundColor: theme.inputBg,
    borderWidth: 1,
    borderColor: theme.inputBorder,
    borderRadius: 14,
    color: theme.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    fontSize: 15,
  },
  errorText: { color: theme.danger, marginBottom: 12, fontSize: 12 },
  successText: { color: '#c4b5fd', marginBottom: 12, fontSize: 12 },
  submitButton: {
    marginTop: 8,
    backgroundColor: theme.accent,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  submitButtonPressed: { backgroundColor: theme.accentPressed },
  submitButtonText: {
    color: '#f5f3ff',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.3,
  },
  footerText: {
    marginTop: 20,
    color: theme.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
  linkText: { color: '#c4b5fd', fontWeight: '700' },
});
