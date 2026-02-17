import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import * as Location from 'expo-location';

import api from '../api';
import Map3D from '../components/Map3D';
import LanguageSelector from '../components/LanguageSelector';
import { useI18n } from '../i18n';

const DGIS_KEY = process.env.EXPO_PUBLIC_DGIS_KEY || '0dd55685-621b-43a8-bac3-b1d8ca27d3da';
const chartWidth = Math.max(320, Dimensions.get('window').width - 56);
const graphLabels = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

function parseError(error, fallback = 'Request failed') {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => d?.msg || JSON.stringify(d)).join('; ');
  }
  return detail || error?.message || fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function buildChartData(overview) {
  const baseFlow = toNumber(overview?.base_flow_vehicles_per_hour, 120);
  const detour = toNumber(overview?.detour_increase_percent, 18);
  const ecologyBase = toNumber(overview?.city_metrics?.ecology, 74);
  const socialBase = toNumber(overview?.city_metrics?.social_score, 66);
  const movingRatio = toNumber(overview?.moving_ratio_percent, 35) / 100;

  const trafficStart = clamp(baseFlow * 0.68, 50, 440);
  const trafficGrowth = 1 + detour / 190;

  const traffic = graphLabels.map((_, index) =>
    Math.round(trafficStart * (1 + index * 0.06 * trafficGrowth))
  );
  const ecology = graphLabels.map((_, index) =>
    Math.round(clamp(ecologyBase - index * (1.2 + movingRatio * 2.0), 0, 100))
  );
  const social = graphLabels.map((_, index) =>
    Math.round(clamp(socialBase - index * (0.9 + detour / 110), 0, 100))
  );

  return { labels: graphLabels, traffic, ecology, social };
}

function SectionCard({ title, children }) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ActionButton({ label, onPress, danger, disabled, small }) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.actionButton,
        small && styles.actionButtonSmall,
        danger && styles.actionButtonDanger,
        disabled && styles.actionButtonDisabled,
        pressed && !disabled && styles.actionButtonPressed,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.actionButtonText}>{label}</Text>
    </Pressable>
  );
}

function LegendItem({ color, label }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

export default function MainMap({ token, onLogout, isGuest = false }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastAction, setLastAction] = useState(() => t('map.status.waiting_transport'));
  const [showPredictions, setShowPredictions] = useState(true);

  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [route, setRoute] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState('');

  const [transportOverview, setTransportOverview] = useState(null);
  const [chartData, setChartData] = useState(() => buildChartData(null));

  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessages, setAiMessages] = useState(() => [
    {
      role: 'assistant',
      text: t('ai.welcome'),
    },
  ]);

  const authHeaders = useMemo(() => {
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  const loadTransportOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/api/simulation/transport/overview', { headers: authHeaders });
      const next = response.data || {};
      setTransportOverview(next);
      setChartData(buildChartData(next));
      setLastAction(t('map.status.change_graph_updated'));
      return next;
    } catch (e) {
      const message = parseError(e, t('common.request_failed'));
      setError(message);
      setLastAction(t('map.status.transport_update_failed'));
      throw e;
    } finally {
      setLoading(false);
    }
  }, [authHeaders, t]);

  useEffect(() => {
    loadTransportOverview().catch(() => null);
  }, [loadTransportOverview]);

  const resetNavigation = useCallback(() => {
    setOrigin(null);
    setDestination(null);
    setRoute([]);
    setRouteInfo(null);
    setRouteError('');
    setLastAction(t('map.status.tap_to_set_a'));
  }, [t]);

  const requestGpsOrigin = useCallback(async () => {
    setRouteError('');
    try {
      const permissions = await Location.requestForegroundPermissionsAsync();
      if (permissions.status !== 'granted') {
        setLastAction(t('map.status.location_denied'));
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const latitude = toNumber(pos?.coords?.latitude, NaN);
      const longitude = toNumber(pos?.coords?.longitude, NaN);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        setLastAction(t('map.status.location_read_failed'));
        return;
      }

      setOrigin({ latitude, longitude, source: 'gps' });
      setLastAction(t('map.status.gps_a_set_tap_b'));
    } catch (e) {
      setLastAction(t('map.status.location_lookup_failed'));
      setRouteError(parseError(e, t('common.request_failed')));
    }
  }, [t]);

  useEffect(() => {
    requestGpsOrigin().catch(() => null);
  }, [requestGpsOrigin]);

  const buildRoute = useCallback(
    async (from, to) => {
      if (!from || !to) return;

      setRouteBusy(true);
      setRouteError('');

      try {
        const response = await api.post(
          '/api/routes/optimize',
          {
            origin: [from.longitude, from.latitude],
            destination: [to.longitude, to.latitude],
            transport_mode: 'driving',
            include_traffic_prediction: false,
            use_ai_recommendation: false,
          },
          { headers: authHeaders }
        );

        const payload = response.data || {};
        const routes = Array.isArray(payload.routes) ? payload.routes : [];
        const recommended = Number.isInteger(payload.recommended_route_index)
          ? payload.recommended_route_index
          : 0;
        const selected = routes[recommended] || routes[0] || null;
        const geometry = Array.isArray(selected?.geometry) ? selected.geometry : [];

        setRoute(geometry);
        setRouteInfo(selected);
        setLastAction(
          selected?.summary
            ? t('map.status.route_ready_summary', { summary: selected.summary })
            : t('map.status.route_ready')
        );
      } catch (e) {
        setRoute([]);
        setRouteInfo(null);
        setRouteError(parseError(e, t('common.request_failed')));
        setLastAction(t('map.status.route_build_failed'));
      } finally {
        setRouteBusy(false);
      }
    },
    [authHeaders, t]
  );

  const onMapPress = useCallback(
    (coords) => {
      if (routeBusy) return;
      const latitude = toNumber(coords?.latitude, NaN);
      const longitude = toNumber(coords?.longitude, NaN);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

      const clicked = { latitude, longitude, source: 'map' };
      setRouteError('');

      if (!origin) {
        setOrigin({ ...clicked, source: 'manual' });
        setDestination(null);
        setRoute([]);
        setRouteInfo(null);
        setLastAction(t('map.status.start_set_tap_b'));
        return;
      }

      setDestination(clicked);
      buildRoute(origin, clicked);
    },
    [origin, buildRoute, routeBusy, t]
  );

  const mapPoints = useMemo(() => {
    const points = [];

    if (origin) {
      points.push({
        id: 'origin',
        name: origin.source === 'gps' ? t('map.point.me_a') : t('map.point.start_a'),
        category: 'vehicle',
        latitude: origin.latitude,
        longitude: origin.longitude,
      });
    }

    if (destination) {
      points.push({
        id: 'destination',
        name: t('map.point.destination_b'),
        category: 'general',
        latitude: destination.latitude,
        longitude: destination.longitude,
      });
    }

    return points;
  }, [origin, destination, t]);

  const buildLocalAgentReply = useCallback(
    (prompt, overview = transportOverview) => {
      const text = String(prompt || '').toLowerCase();
      const flow = toNumber(overview?.base_flow_vehicles_per_hour, 0);
      const detour = toNumber(overview?.detour_increase_percent, 0);
      const ecology = toNumber(overview?.city_metrics?.ecology, 0);

      if (/мост|bridge/.test(text)) {
        return t('ai.fallback.bridge', {
          flow: flow || '~',
          detour: detour || '~',
        });
      }

      if (/трафик|traffic|пробк/.test(text)) {
        return t('ai.fallback.traffic', {
          moving: overview?.moving_ratio_percent ?? '~',
        });
      }

      if (/эколог|air|выброс/.test(text)) {
        return t('ai.fallback.ecology', { ecology: ecology || '~' });
      }

      return t('ai.fallback.default');
    },
    [transportOverview, t]
  );

  const submitAiPrompt = async () => {
    const prompt = aiInput.trim();
    if (!prompt || aiBusy) return;

    setAiInput('');
    setAiBusy(true);

    const nextMessages = [...aiMessages, { role: 'user', text: prompt }];
    setAiMessages(nextMessages);

    try {
      const overview = await loadTransportOverview();
      const history = nextMessages
        .slice(-9, -1)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.text }));

      const response = await api.post(
        '/api/ai/predict',
        {
          prompt,
          history,
          context: {
            transport_overview: overview,
            graph_snapshot: chartData,
            map_traffic_layer: '2gis-live',
            guest_mode: Boolean(isGuest),
          },
        },
        { headers: authHeaders }
      );

      setAiMessages((prev) => [
        ...prev,
        { role: 'assistant', text: response.data?.answer || buildLocalAgentReply(prompt, overview) },
      ]);
    } catch {
      setAiMessages((prev) => [
        ...prev,
        { role: 'assistant', text: buildLocalAgentReply(prompt) },
      ]);
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>HOGMAPS</Text>
          <Text style={styles.subtitle}>{t('map.control_center')}</Text>
        </View>

        <View style={styles.headerActions}>
          <LanguageSelector compact />
          <ActionButton
            label={t('map.refresh_changes')}
            onPress={() => loadTransportOverview().catch(() => null)}
            disabled={loading}
            small
          />
          <ActionButton label={t('map.logout')} onPress={onLogout} danger small />
        </View>
      </View>

      <View style={styles.mapWrap}>
        <Map3D points={mapPoints} route={route} apiKey={DGIS_KEY} onMapPress={onMapPress} style={styles.map} />
      </View>

      <View style={styles.mapInfoRow}>
        <Text style={styles.statsText}>
          {t('map.dgis_key')}: {DGIS_KEY ? t('map.active') : t('map.missing')}
        </Text>
        <Text style={styles.statsText}>
          {t('map.congestion')}: {transportOverview?.congestion_level || t('common.unknown')}
        </Text>
        {loading ? <ActivityIndicator size="small" color="#a78bfa" /> : null}
        {routeBusy ? <ActivityIndicator size="small" color="#22d3ee" /> : null}
        <ActionButton
          label={showPredictions ? t('map.hide_graph') : t('map.show_graph')}
          onPress={() => setShowPredictions((v) => !v)}
          small
        />
      </View>

      <View style={styles.mapInfoRow}>
        <Text style={styles.statsText}>
          {t('map.start_label')}:{' '}
          {origin ? (origin.source === 'gps' ? 'GPS' : t('map.manual')) : t('map.tap_map_a')}
        </Text>
        <Text style={styles.statsText}>
          {t('map.destination_label')}: {destination ? t('map.destination_set') : t('map.tap_map_b')}
        </Text>
        <ActionButton
          label={t('map.use_my_location')}
          onPress={() => requestGpsOrigin().catch(() => null)}
          disabled={routeBusy}
          small
        />
        <ActionButton
          label={t('map.reset_ab')}
          onPress={resetNavigation}
          danger
          disabled={routeBusy}
          small
        />
      </View>

      {routeInfo ? (
        <Text style={styles.metaText}>
          {t('map.route_info', {
            km: toNumber(routeInfo.distance_km, 0),
            min: Math.round(
              toNumber(routeInfo.duration_with_traffic_minutes, routeInfo.duration_minutes || 0)
            ),
          })}
        </Text>
      ) : null}

      {routeError ? <Text style={styles.errorText}>{routeError}</Text> : null}

      <View style={styles.legendRow}>
        <LegendItem color="#16a34a" label={t('map.legend_green')} />
        <LegendItem color="#eab308" label={t('map.legend_yellow')} />
        <LegendItem color="#dc2626" label={t('map.legend_red')} />
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <ScrollView contentContainerStyle={styles.content}>
        {showPredictions ? (
          <SectionCard title={t('map.section.change_graph')}>
            <LineChart
              data={{
                labels: chartData.labels,
                datasets: [
                  {
                    data: chartData.traffic,
                    color: () => '#f59e0b',
                    strokeWidth: 2,
                  },
                  {
                    data: chartData.ecology,
                    color: () => '#22d3ee',
                    strokeWidth: 2,
                  },
                  {
                    data: chartData.social,
                    color: () => '#a3e635',
                    strokeWidth: 2,
                  },
                ],
                legend: [t('map.metric.traffic'), t('map.metric.ecology'), t('map.metric.social')],
              }}
              width={chartWidth}
              height={220}
              withShadow={false}
              withInnerLines
              chartConfig={stylesForCharts.line}
              style={styles.chart}
              bezier
            />

            {transportOverview ? (
              <View style={styles.impactCard}>
                <Text style={styles.impactText}>
                  {t('map.flow')}: {transportOverview.base_flow_vehicles_per_hour} {t('map.vehicles_per_hour')} |{' '}
                  {t('map.detour')}: {transportOverview.detour_increase_percent}% | {t('map.congestion')}:{' '}
                  {transportOverview.congestion_level}
                </Text>
                <Text style={styles.metaText}>
                  {t('map.metric.ecology')}: {transportOverview?.city_metrics?.ecology} |{' '}
                  {t('map.metric.traffic')}: {transportOverview?.city_metrics?.traffic_load} |{' '}
                  {t('map.metric.social')}: {transportOverview?.city_metrics?.social_score}
                </Text>
              </View>
            ) : null}
          </SectionCard>
        ) : null}

        <SectionCard title={t('map.system_status')}>
          <Text style={styles.metaText}>{lastAction}</Text>
        </SectionCard>
      </ScrollView>

      <Pressable style={styles.aiFab} onPress={() => setAiOpen(true)}>
        <Text style={styles.aiFabText}>{t('ai.agent')}</Text>
      </Pressable>

      <Modal visible={aiOpen} transparent animationType="slide" onRequestClose={() => setAiOpen(false)}>
        <View style={styles.aiOverlay}>
          <View style={styles.aiPanel}>
            <View style={styles.aiHeader}>
              <Text style={styles.aiTitle}>{t('ai.agent')}</Text>
              <ActionButton label={t('ai.close')} onPress={() => setAiOpen(false)} danger small />
            </View>

            <ScrollView style={styles.aiMessages} contentContainerStyle={styles.aiMessagesContent}>
              {aiMessages.map((msg, idx) => (
                <View
                  key={`${msg.role}-${idx}`}
                  style={[styles.aiBubble, msg.role === 'user' ? styles.aiBubbleUser : styles.aiBubbleAssistant]}
                >
                  <Text style={styles.aiBubbleText}>{msg.text}</Text>
                </View>
              ))}
            </ScrollView>

            <TextInput
              value={aiInput}
              onChangeText={setAiInput}
              placeholder={t('ai.placeholder')}
              placeholderTextColor="#b6a5ff"
              style={styles.aiInput}
              multiline
            />

            <ActionButton
              label={aiBusy ? t('ai.thinking') : t('ai.send')}
              onPress={submitAiPrompt}
              disabled={aiBusy}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const stylesForCharts = {
  line: {
    backgroundColor: '#0f0822',
    backgroundGradientFrom: '#0f0822',
    backgroundGradientTo: '#1b1038',
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(210, 200, 255, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(210, 200, 255, ${opacity})`,
    propsForDots: {
      r: '3',
      strokeWidth: '1',
      stroke: '#c4b5fd',
    },
  },
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#070313',
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'web' ? 16 : 44,
  },
  header: {
    marginBottom: 10,
  },
  title: {
    color: '#f5f3ff',
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    color: '#c4b5fd',
    marginTop: 4,
    marginBottom: 10,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  mapWrap: {
    height: 430,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2e1065',
    marginBottom: 8,
    backgroundColor: '#0b0820',
  },
  map: {
    height: '100%',
  },
  mapInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  statsText: {
    color: '#ddd6fe',
    fontSize: 13,
  },
  legendRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#4c1d95',
    backgroundColor: '#1a1034',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginRight: 8,
  },
  legendText: {
    color: '#ddd6fe',
    fontSize: 12,
    fontWeight: '600',
  },
  errorText: {
    color: '#fb7185',
    marginBottom: 8,
  },
  content: {
    gap: 10,
    paddingBottom: 24,
  },
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3b1c72',
    backgroundColor: '#110822',
    padding: 12,
    gap: 10,
  },
  sectionTitle: {
    color: '#f5f3ff',
    fontWeight: '800',
    fontSize: 16,
  },
  metaText: {
    color: '#ddd6fe',
    fontSize: 13,
  },
  chart: {
    borderRadius: 12,
  },
  impactCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#7c3aed',
    backgroundColor: '#190b33',
    padding: 10,
    gap: 4,
  },
  impactText: {
    color: '#f5f3ff',
    fontWeight: '700',
  },
  actionButton: {
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#6d28d9',
    backgroundColor: '#5b21b6',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonSmall: {
    minHeight: 30,
    paddingHorizontal: 10,
  },
  actionButtonDanger: {
    borderColor: '#9f1239',
    backgroundColor: '#be123c',
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionButtonPressed: {
    transform: [{ scale: 0.98 }],
  },
  actionButtonText: {
    color: '#f5f3ff',
    fontWeight: '700',
    fontSize: 12,
  },
  aiFab: {
    position: 'absolute',
    right: 18,
    bottom: 22,
    borderRadius: 24,
    backgroundColor: '#7c3aed',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#c4b5fd',
  },
  aiFabText: {
    color: '#f5f3ff',
    fontWeight: '800',
  },
  aiOverlay: {
    flex: 1,
    backgroundColor: 'rgba(7, 3, 19, 0.88)',
    justifyContent: 'flex-end',
  },
  aiPanel: {
    backgroundColor: '#130a29',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#4c1d95',
    padding: 14,
    gap: 10,
    maxHeight: '88%',
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  aiTitle: {
    color: '#f5f3ff',
    fontSize: 18,
    fontWeight: '800',
  },
  aiMessages: {
    maxHeight: 300,
  },
  aiMessagesContent: {
    gap: 8,
    paddingVertical: 4,
  },
  aiBubble: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxWidth: '90%',
  },
  aiBubbleUser: {
    backgroundColor: '#5b21b6',
    alignSelf: 'flex-end',
  },
  aiBubbleAssistant: {
    backgroundColor: '#2e1065',
    alignSelf: 'flex-start',
  },
  aiBubbleText: {
    color: '#f5f3ff',
    fontSize: 13,
    lineHeight: 18,
  },
  aiInput: {
    minHeight: 72,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#6d28d9',
    backgroundColor: '#140b2b',
    color: '#f5f3ff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: 'top',
  },
});
