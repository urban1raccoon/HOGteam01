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
import LanguageSelector from './src/components/LanguageSelector';
import { I18nProvider, useI18n } from './src/i18n';

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
  return detail || error?.message;
}

export default function App() {
  return (
    <I18nProvider initialLang="ru">
      <AppInner />
    </I18nProvider>
  );
}

function AppInner() {
  const { t } = useI18n();
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
    setSuccess(t('auth.guest_mode_enabled'));
    setError('');
  };

  const submitAuth = async () => {
    resetMessages();

    if (mode === 'register' && form.password !== form.confirmPassword) {
      setError(t('auth.passwords_do_not_match'));
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

        const username = response.data?.username || t('common.user');
        setSuccess(t('auth.user_created', { username }));
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
        if (!nextToken) throw new Error(t('auth.token_missing'));

        setToken(nextToken);
        setGuestMode(false);
        setSuccess(
          t('auth.welcome', { username: response.data?.user?.username || t('common.user') })
        );
      }
    } catch (e) {
      setError(parseError(e) || t('common.request_failed'));
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
        <Text style={styles.skipSideText}>{t('auth.skip_auth')}</Text>
      </Pressable>

      <KeyboardAvoidingView
        style={styles.keyboardArea}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <View style={styles.cardTopRow}>
              <Text style={styles.kicker}>{t('app.title')}</Text>
              <LanguageSelector compact />
            </View>
            <Text style={styles.title}>
              {mode === 'register' ? t('auth.create_account') : t('auth.sign_in')}
            </Text>
            {t('auth.subtitle') ? <Text style={styles.subtitle}>{t('auth.subtitle')}</Text> : null}

            {mode === 'register' ? (
              <>
                <FormField
                  label={t('auth.nickname')}
                  placeholder={t('auth.placeholder.nickname')}
                  value={form.username}
                  onChangeText={(v) => onChange('username', v)}
                  autoCapitalize="none"
                />
                <FormField
                  label={t('auth.email')}
                  placeholder={t('auth.placeholder.email')}
                  value={form.email}
                  onChangeText={(v) => onChange('email', v)}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <FormField
                  label={t('auth.password')}
                  placeholder={t('auth.placeholder.password')}
                  value={form.password}
                  onChangeText={(v) => onChange('password', v)}
                  secureTextEntry
                />
                <FormField
                  label={t('auth.confirm_password')}
                  placeholder={t('auth.placeholder.confirm_password')}
                  value={form.confirmPassword}
                  onChangeText={(v) => onChange('confirmPassword', v)}
                  secureTextEntry
                />
              </>
            ) : (
              <>
                <FormField
                  label={t('auth.login')}
                  placeholder={t('auth.placeholder.login')}
                  value={form.login}
                  onChangeText={(v) => onChange('login', v)}
                  autoCapitalize="none"
                />
                <FormField
                  label={t('auth.password')}
                  placeholder={t('auth.placeholder.password_login')}
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
                {loading
                  ? t('auth.please_wait')
                  : mode === 'register'
                    ? t('auth.sign_up_button')
                    : t('auth.sign_in_button')}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                resetMessages();
                setMode((prev) => (prev === 'register' ? 'login' : 'register'));
              }}
            >
              <Text style={styles.footerText}>
                {mode === 'register' ? t('auth.already_have_account') : t('auth.no_account_yet')}
                <Text style={styles.linkText}>
                  {mode === 'register' ? t('auth.sign_in') : t('auth.create_one_link')}
                </Text>
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
    marginBottom: 0,
    textTransform: 'uppercase',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
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
