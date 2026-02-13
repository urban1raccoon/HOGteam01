import { StatusBar } from 'expo-status-bar';
import {
  Animated,
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
import { useEffect, useRef, useState } from 'react';

const theme = {
  bg: '#06070C',
  panel: '#121622',
  panelBorder: '#2A3148',
  textPrimary: '#F4F6FF',
  textSecondary: '#9BA7CB',
  accent: '#43C7B9',
  accentPressed: '#2DAA9D',
  inputBg: '#0D1220',
  inputBorder: '#2B3554',
  inputFocus: '#43C7B9',
  danger: '#FF6B7A',
};

export default function App() {
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [focused, setFocused] = useState('');
  const [submitPressed, setSubmitPressed] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const riseAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(riseAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, riseAnim]);

  const onChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const passwordsMismatch =
    form.confirmPassword.length > 0 && form.password !== form.confirmPassword;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      <View style={styles.bgDecorTop} />
      <View style={styles.bgDecorBottom} />

      <KeyboardAvoidingView
        style={styles.keyboardArea}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View
            style={[
              styles.card,
              { opacity: fadeAnim, transform: [{ translateY: riseAnim }] },
            ]}
          >
            <Text style={styles.kicker}>HOG MAPS</Text>
            <Text style={styles.title}>Create account</Text>
            <Text style={styles.subtitle}>
              Register to manage scenarios and launch simulations.
            </Text>

            <FormField
              label="Nickname"
              placeholder="your name"
              value={form.username}
              onChangeText={(v) => onChange('username', v)}
              autoCapitalize="none"
              focused={focused === 'username'}
              onFocus={() => setFocused('username')}
              onBlur={() => setFocused('')}
            />

            <FormField
              label="Email"
              placeholder="yourmail@example.com"
              value={form.email}
              onChangeText={(v) => onChange('email', v)}
              keyboardType="email-address"
              autoCapitalize="none"
              focused={focused === 'email'}
              onFocus={() => setFocused('email')}
              onBlur={() => setFocused('')}
            />

            <FormField
              label="Password"
              placeholder="At least 8 characters"
              value={form.password}
              onChangeText={(v) => onChange('password', v)}
              secureTextEntry
              focused={focused === 'password'}
              onFocus={() => setFocused('password')}
              onBlur={() => setFocused('')}
            />

            <FormField
              label="Confirm password"
              placeholder="Repeat password"
              value={form.confirmPassword}
              onChangeText={(v) => onChange('confirmPassword', v)}
              secureTextEntry
              focused={focused === 'confirmPassword'}
              onFocus={() => setFocused('confirmPassword')}
              onBlur={() => setFocused('')}
            />

            {passwordsMismatch ? (
              <Text style={styles.errorText}>Passwords do not match</Text>
            ) : null}

            <Pressable
              onPress={() => setSubmitPressed(true)}
              style={({ pressed }) => [
                styles.submitButton,
                pressed && styles.submitButtonPressed,
              ]}
            >
              <Text style={styles.submitButtonText}>Sign up</Text>
            </Pressable>

            {submitPressed ? (
              <Text style={styles.templateNote}>
                Template mode: connect this button to POST /api/auth/register.
              </Text>
            ) : null}

            <Text style={styles.footerText}>
              Already have an account? <Text style={styles.linkText}>Sign in</Text>
            </Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FormField({ label, focused, ...inputProps }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...inputProps}
        style={[styles.input, focused && styles.inputFocused]}
        placeholderTextColor={theme.textSecondary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  keyboardArea: {
    flex: 1,
  },
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
    backgroundColor: '#1B2E55',
    opacity: 0.65,
  },
  bgDecorBottom: {
    position: 'absolute',
    bottom: -120,
    left: -60,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#15483F',
    opacity: 0.6,
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
    color: theme.accent,
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
  fieldWrap: {
    marginBottom: 14,
  },
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
  inputFocused: {
    borderColor: theme.inputFocus,
  },
  errorText: {
    color: theme.danger,
    marginBottom: 12,
    fontSize: 12,
  },
  submitButton: {
    marginTop: 8,
    backgroundColor: theme.accent,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  submitButtonPressed: {
    backgroundColor: theme.accentPressed,
  },
  submitButtonText: {
    color: '#022A27',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.3,
  },
  templateNote: {
    marginTop: 10,
    color: theme.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  footerText: {
    marginTop: 20,
    color: theme.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
  linkText: {
    color: theme.accent,
    fontWeight: '700',
  },
});
