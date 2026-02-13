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

const API_BASE_URL = 'https://web-production-e7886.up.railway.app';
const API_BASE_URL_NORMALIZED = API_BASE_URL.replace(/\/+$/, '');

function buildApiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL_NORMALIZED}${normalizedPath}`;
}

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

const SAMPLE_VEHICLE = JSON.stringify(
  {
    id: 'veh-001',
    name: 'Truck 1',
    capacity: 120,
    current_location: { lat: 49.95, lng: 82.61 },
    status: 'idle',
    route: [],
  },
  null,
  2
);

const SAMPLE_POINT = JSON.stringify(
  {
    id: 'dp-001',
    name: 'Point A',
    location: { lat: 49.96, lng: 82.63 },
    demand: 25,
    time_window_start: '08:00',
    time_window_end: '18:00',
  },
  null,
  2
);

const SAMPLE_SCENARIO = JSON.stringify(
  {
    name: 'Morning test',
    description: 'Scenario from frontend',
    influence_point_ids: [],
    vehicle_ids: ['veh-001'],
    delivery_point_ids: ['dp-001'],
    start_time: new Date().toISOString(),
    duration_hours: 8,
  },
  null,
  2
);

const SAMPLE_SIMULATION_RUN = JSON.stringify(
  {
    vehicles: [
      {
        id: 'veh-001',
        name: 'Truck 1',
        capacity: 120,
        current_location: { lat: 49.95, lng: 82.61 },
        status: 'idle',
        route: [],
      },
    ],
    delivery_points: [
      {
        id: 'dp-001',
        name: 'Point A',
        location: { lat: 49.96, lng: 82.63 },
        demand: 25,
        time_window_start: '08:00',
        time_window_end: '18:00',
      },
    ],
    start_time: new Date().toISOString(),
    duration_hours: 8,
  },
  null,
  2
);

export default function App() {
  const [mode, setMode] = useState('register');
  const [form, setForm] = useState({
    username: '',
    email: '',
    login: '',
    password: '',
    confirmPassword: '',
  });
  const [focused, setFocused] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [token, setToken] = useState('');
  const [apiLoading, setApiLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState('');
  const [apiResult, setApiResult] = useState('');

  const [vehicleId, setVehicleId] = useState('veh-001');
  const [vehicleJson, setVehicleJson] = useState(SAMPLE_VEHICLE);

  const [pointId, setPointId] = useState('dp-001');
  const [pointJson, setPointJson] = useState(SAMPLE_POINT);

  const [scenarioId, setScenarioId] = useState('');
  const [scenarioJson, setScenarioJson] = useState(SAMPLE_SCENARIO);

  const [impactType, setImpactType] = useState('park');
  const [simulationRunJson, setSimulationRunJson] = useState(SAMPLE_SIMULATION_RUN);
  const [simulationId, setSimulationId] = useState('');

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const riseAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(riseAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, riseAnim]);

  const onChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const passwordsMismatch =
    mode === 'register' &&
    form.confirmPassword.length > 0 &&
    form.password !== form.confirmPassword;

  const resetMessages = () => {
    setError('');
    setSuccess('');
  };

  const parseJson = (value, label) => {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`Invalid JSON for ${label}`);
    }
  };

  const normalizeResponse = async (res) => {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };

  const extractError = (statusCode, data) => {
    if (typeof data === 'string') return `HTTP ${statusCode}: ${data}`;
    if (data?.detail) {
      if (Array.isArray(data.detail)) {
        return `HTTP ${statusCode}: ${data.detail
          .map((d) => d.msg || JSON.stringify(d))
          .join('; ')}`;
      }
      return `HTTP ${statusCode}: ${data.detail}`;
    }
    return `HTTP ${statusCode}: Request failed`;
  };

  const runRequest = async ({
    label,
    path,
    method = 'GET',
    body,
    requireAuth = false,
  }) => {
    setApiStatus(`Running: ${label}`);
    setApiResult('');
    setApiLoading(true);

    try {
      if (requireAuth && !token) {
        throw new Error('Token is required for this endpoint');
      }

      const headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(buildApiUrl(path), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      const data = await normalizeResponse(res);
      if (!res.ok) {
        throw new Error(extractError(res.status, data));
      }

      setApiStatus(`Done: ${label} (HTTP ${res.status})`);
      setApiResult(
        JSON.stringify(
          {
            endpoint: `${method} ${path}`,
            status: res.status,
            data,
          },
          null,
          2
        )
      );
    } catch (e) {
      setApiStatus(`Failed: ${label}`);
      setApiResult(e.message || 'Request failed');
    } finally {
      setApiLoading(false);
    }
  };

  const runJsonRequest = ({ label, path, method, rawJson, jsonLabel }) => {
    try {
      const parsed = parseJson(rawJson, jsonLabel);
      runRequest({ label, path, method, body: parsed });
    } catch (e) {
      setApiStatus(`Failed: ${label}`);
      setApiResult(e.message || 'Invalid JSON');
    }
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
        const res = await fetch(buildApiUrl('/api/auth/register'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: form.username,
            email: form.email,
            password: form.password,
            confirmPassword: form.confirmPassword,
          }),
        });

        const data = await normalizeResponse(res);
        if (!res.ok) {
          throw new Error(extractError(res.status, data));
        }

        setSuccess(`User ${data.username} created`);
        setMode('login');
        setForm((prev) => ({
          ...prev,
          login: prev.email,
          password: '',
          confirmPassword: '',
        }));
      } else {
        const res = await fetch(buildApiUrl('/api/auth/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            login: form.login,
            password: form.password,
          }),
        });

        const data = await normalizeResponse(res);
        if (!res.ok) {
          throw new Error(extractError(res.status, data));
        }

        setToken(data.access_token);
        setSuccess(`Welcome, ${data.user.username}`);
      }
    } catch (e) {
      setError(e.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setToken('');
    setApiStatus('');
    setApiResult('');
    setSuccess('Logged out');
    setError('');
    setMode('login');
  };

  if (!token) {
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
              <Text style={styles.title}>
                {mode === 'register' ? 'Create account' : 'Sign in'}
              </Text>
              <Text style={styles.subtitle}>Auth works first, then dashboard opens.</Text>

              {mode === 'register' ? (
                <>
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
                </>
              ) : (
                <>
                  <FormField
                    label="Login"
                    placeholder="username or email"
                    value={form.login}
                    onChangeText={(v) => onChange('login', v)}
                    autoCapitalize="none"
                    focused={focused === 'login'}
                    onFocus={() => setFocused('login')}
                    onBlur={() => setFocused('')}
                  />

                  <FormField
                    label="Password"
                    placeholder="Your password"
                    value={form.password}
                    onChangeText={(v) => onChange('password', v)}
                    secureTextEntry
                    focused={focused === 'password'}
                    onFocus={() => setFocused('password')}
                    onBlur={() => setFocused('')}
                  />
                </>
              )}

              {passwordsMismatch ? (
                <Text style={styles.errorText}>Passwords do not match</Text>
              ) : null}

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
                    ? 'Please wait...'
                    : mode === 'register'
                    ? 'Sign up'
                    : 'Sign in'}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  resetMessages();
                  setMode((prev) => (prev === 'register' ? 'login' : 'register'));
                }}
              >
                <Text style={styles.footerText}>
                  {mode === 'register'
                    ? 'Already have an account? '
                    : 'No account yet? '}
                  <Text style={styles.linkText}>
                    {mode === 'register' ? 'Sign in' : 'Create one'}
                  </Text>
                </Text>
              </Pressable>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.bgDecorTop} />
      <View style={styles.bgDecorBottom} />

      <ScrollView style={styles.dashboard} contentContainerStyle={styles.dashboardContent}>
        <Text style={styles.kicker}>HOG MAPS</Text>
        <Text style={styles.title}>API Dashboard</Text>
        <Text style={styles.subtitle}>Base URL: {API_BASE_URL}</Text>
        <Text style={styles.templateNote}>Token: {token.slice(0, 36)}...</Text>

        <Pressable style={styles.ghostButton} onPress={logout}>
          <Text style={styles.ghostButtonText}>Logout</Text>
        </Pressable>

        <Panel title="1. User">
          <Text style={styles.panelDescription}>Check current authorized user.</Text>
          <ActionButton
            label="GET /api/auth/me"
            onPress={() => runRequest({ label: 'auth me', path: '/api/auth/me', requireAuth: true })}
            loading={apiLoading}
          />
        </Panel>

        <Panel title="2. Objects on map">
          <ActionButton
            label="GET /api/objects/map/all"
            onPress={() => runRequest({ label: 'map all', path: '/api/objects/map/all' })}
            loading={apiLoading}
          />

          <ActionButton
            label="GET /api/objects/vehicles"
            onPress={() => runRequest({ label: 'list vehicles', path: '/api/objects/vehicles' })}
            loading={apiLoading}
          />

          <FormField label="Vehicle ID" value={vehicleId} onChangeText={setVehicleId} />
          <ActionRow>
            <ActionButton
              label="GET by id"
              onPress={() =>
                runRequest({
                  label: 'vehicle by id',
                  path: `/api/objects/vehicles/${encodeURIComponent(vehicleId)}`,
                })
              }
              loading={apiLoading}
            />
            <ActionButton
              label="DELETE by id"
              danger
              onPress={() =>
                runRequest({
                  label: 'delete vehicle',
                  path: `/api/objects/vehicles/${encodeURIComponent(vehicleId)}`,
                  method: 'DELETE',
                })
              }
              loading={apiLoading}
            />
          </ActionRow>

          <Text style={styles.fieldLabel}>Vehicle JSON (POST/PUT)</Text>
          <TextInput
            value={vehicleJson}
            onChangeText={setVehicleJson}
            multiline
            style={[styles.input, styles.jsonInput]}
            placeholderTextColor={theme.textSecondary}
          />
          <ActionRow>
            <ActionButton
              label="POST vehicle"
              onPress={() =>
                runJsonRequest({
                  label: 'create vehicle',
                  path: '/api/objects/vehicles',
                  method: 'POST',
                  rawJson: vehicleJson,
                  jsonLabel: 'vehicle',
                })
              }
              loading={apiLoading}
            />
            <ActionButton
              label="PUT vehicle"
              onPress={() =>
                runJsonRequest({
                  label: 'update vehicle',
                  path: `/api/objects/vehicles/${encodeURIComponent(vehicleId)}`,
                  method: 'PUT',
                  rawJson: vehicleJson,
                  jsonLabel: 'vehicle',
                })
              }
              loading={apiLoading}
            />
          </ActionRow>

          <ActionButton
            label="GET /api/objects/delivery-points"
            onPress={() =>
              runRequest({
                label: 'list delivery points',
                path: '/api/objects/delivery-points',
              })
            }
            loading={apiLoading}
          />

          <FormField label="Delivery Point ID" value={pointId} onChangeText={setPointId} />
          <ActionRow>
            <ActionButton
              label="GET point by id"
              onPress={() =>
                runRequest({
                  label: 'delivery point by id',
                  path: `/api/objects/delivery-points/${encodeURIComponent(pointId)}`,
                })
              }
              loading={apiLoading}
            />
            <ActionButton
              label="DELETE point"
              danger
              onPress={() =>
                runRequest({
                  label: 'delete delivery point',
                  path: `/api/objects/delivery-points/${encodeURIComponent(pointId)}`,
                  method: 'DELETE',
                })
              }
              loading={apiLoading}
            />
          </ActionRow>

          <Text style={styles.fieldLabel}>Delivery Point JSON (POST/PUT)</Text>
          <TextInput
            value={pointJson}
            onChangeText={setPointJson}
            multiline
            style={[styles.input, styles.jsonInput]}
            placeholderTextColor={theme.textSecondary}
          />
          <ActionRow>
            <ActionButton
              label="POST point"
              onPress={() =>
                runJsonRequest({
                  label: 'create delivery point',
                  path: '/api/objects/delivery-points',
                  method: 'POST',
                  rawJson: pointJson,
                  jsonLabel: 'delivery point',
                })
              }
              loading={apiLoading}
            />
            <ActionButton
              label="PUT point"
              onPress={() =>
                runJsonRequest({
                  label: 'update delivery point',
                  path: `/api/objects/delivery-points/${encodeURIComponent(pointId)}`,
                  method: 'PUT',
                  rawJson: pointJson,
                  jsonLabel: 'delivery point',
                })
              }
              loading={apiLoading}
            />
          </ActionRow>
        </Panel>

        <Panel title="3. Scenarios">
          <ActionButton
            label="GET /api/scenarios"
            onPress={() => runRequest({ label: 'list scenarios', path: '/api/scenarios' })}
            loading={apiLoading}
          />

          <FormField
            label="Scenario ID"
            value={scenarioId}
            onChangeText={setScenarioId}
            placeholder="paste scenario id"
          />

          <ActionRow>
            <ActionButton
              label="GET by id"
              onPress={() =>
                runRequest({
                  label: 'scenario by id',
                  path: `/api/scenarios/${encodeURIComponent(scenarioId)}`,
                })
              }
              loading={apiLoading}
            />
            <ActionButton
              label="DELETE by id"
              danger
              onPress={() =>
                runRequest({
                  label: 'delete scenario',
                  path: `/api/scenarios/${encodeURIComponent(scenarioId)}`,
                  method: 'DELETE',
                })
              }
              loading={apiLoading}
            />
          </ActionRow>

          <Text style={styles.fieldLabel}>Scenario JSON (POST/PUT)</Text>
          <TextInput
            value={scenarioJson}
            onChangeText={setScenarioJson}
            multiline
            style={[styles.input, styles.jsonInput]}
            placeholderTextColor={theme.textSecondary}
          />

          <ActionRow>
            <ActionButton
              label="POST scenario"
              onPress={() =>
                runJsonRequest({
                  label: 'create scenario',
                  path: '/api/scenarios',
                  method: 'POST',
                  rawJson: scenarioJson,
                  jsonLabel: 'scenario',
                })
              }
              loading={apiLoading}
            />
            <ActionButton
              label="PUT scenario"
              onPress={() =>
                runJsonRequest({
                  label: 'update scenario',
                  path: `/api/scenarios/${encodeURIComponent(scenarioId)}`,
                  method: 'PUT',
                  rawJson: scenarioJson,
                  jsonLabel: 'scenario',
                })
              }
              loading={apiLoading}
            />
          </ActionRow>
        </Panel>

        <Panel title="4. Simulation">
          <FormField
            label="Object type (impact)"
            value={impactType}
            onChangeText={setImpactType}
            placeholder="park | school | factory | ..."
          />

          <ActionButton
            label="GET /api/simulation/impact"
            onPress={() =>
              runRequest({
                label: 'impact',
                path: `/api/simulation/impact?object_type=${encodeURIComponent(
                  impactType
                )}`,
              })
            }
            loading={apiLoading}
          />

          <Text style={styles.fieldLabel}>Run payload JSON</Text>
          <TextInput
            value={simulationRunJson}
            onChangeText={setSimulationRunJson}
            multiline
            style={[styles.input, styles.jsonInput]}
            placeholderTextColor={theme.textSecondary}
          />

          <ActionButton
            label="POST /api/simulation/run"
            onPress={() =>
              runJsonRequest({
                label: 'run simulation',
                path: '/api/simulation/run',
                method: 'POST',
                rawJson: simulationRunJson,
                jsonLabel: 'simulation run payload',
              })
            }
            loading={apiLoading}
          />

          <FormField
            label="Scenario ID for run-scenario"
            value={scenarioId}
            onChangeText={setScenarioId}
          />
          <ActionButton
            label="POST /api/simulation/run-scenario/{scenario_id}"
            onPress={() =>
              runRequest({
                label: 'run scenario simulation',
                path: `/api/simulation/run-scenario/${encodeURIComponent(scenarioId)}`,
                method: 'POST',
              })
            }
            loading={apiLoading}
          />

          <ActionRow>
            <ActionButton
              label="GET /api/simulation/results"
              onPress={() =>
                runRequest({
                  label: 'simulation results list',
                  path: '/api/simulation/results',
                })
              }
              loading={apiLoading}
            />
            <ActionButton
              label="GET /api/simulation/results/{id}"
              onPress={() =>
                runRequest({
                  label: 'simulation result by id',
                  path: `/api/simulation/results/${encodeURIComponent(simulationId)}`,
                })
              }
              loading={apiLoading}
            />
          </ActionRow>

          <FormField
            label="Simulation ID"
            value={simulationId}
            onChangeText={setSimulationId}
            placeholder="paste simulation id"
          />

          <ActionButton
            label="DELETE /api/simulation/results/{id}"
            danger
            onPress={() =>
              runRequest({
                label: 'delete simulation result',
                path: `/api/simulation/results/${encodeURIComponent(simulationId)}`,
                method: 'DELETE',
              })
            }
            loading={apiLoading}
          />
        </Panel>

        <Panel title="Response">
          <Text style={styles.statusText}>{apiStatus || 'No requests yet'}</Text>
          <ScrollView horizontal>
            <Text style={styles.resultText}>{apiResult || 'Run any action above.'}</Text>
          </ScrollView>
        </Panel>
      </ScrollView>
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

function Panel({ title, children }) {
  return (
    <View style={styles.panelBlock}>
      <Text style={styles.panelTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ActionRow({ children }) {
  return <View style={styles.actionRow}>{children}</View>;
}

function ActionButton({ label, onPress, loading, danger }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        styles.actionButton,
        danger && styles.actionDanger,
        (pressed || loading) && styles.submitButtonPressed,
      ]}
    >
      <Text style={styles.actionButtonText}>{loading ? '...' : label}</Text>
    </Pressable>
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
  dashboard: {
    flex: 1,
  },
  dashboardContent: {
    paddingHorizontal: 18,
    paddingBottom: 24,
    paddingTop: 16,
    gap: 14,
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
  panelBlock: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.panelBorder,
    borderRadius: 16,
    padding: 12,
  },
  panelTitle: {
    color: theme.textPrimary,
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 10,
  },
  panelDescription: {
    color: theme.textSecondary,
    marginBottom: 8,
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
    marginBottom: 12,
    lineHeight: 20,
  },
  fieldWrap: {
    marginBottom: 10,
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
  jsonInput: {
    minHeight: 140,
    textAlignVertical: 'top',
    marginBottom: 8,
  },
  inputFocused: {
    borderColor: theme.inputFocus,
  },
  errorText: {
    color: theme.danger,
    marginBottom: 12,
    fontSize: 12,
  },
  successText: {
    color: theme.accent,
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
    opacity: 0.8,
  },
  submitButtonText: {
    color: '#022A27',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.3,
  },
  ghostButton: {
    borderWidth: 1,
    borderColor: theme.panelBorder,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    marginBottom: 4,
  },
  ghostButtonText: {
    color: theme.textSecondary,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  actionButton: {
    flexGrow: 1,
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    marginBottom: 6,
  },
  actionDanger: {
    backgroundColor: '#C34B63',
  },
  actionButtonText: {
    color: '#041A19',
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
  },
  templateNote: {
    marginTop: 2,
    color: theme.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 8,
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
  statusText: {
    color: theme.textSecondary,
    marginBottom: 8,
    fontSize: 12,
  },
  resultText: {
    color: theme.textPrimary,
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' }),
  },
});
