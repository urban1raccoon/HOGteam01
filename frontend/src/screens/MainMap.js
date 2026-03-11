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

const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '';
const MAPBOX_STYLE_LIGHT =
  process.env.EXPO_PUBLIC_MAPBOX_STYLE_LIGHT || 'mapbox://styles/mapbox/light-v11';
const MAPBOX_STYLE_DARK =
  process.env.EXPO_PUBLIC_MAPBOX_STYLE_DARK || 'mapbox://styles/mapbox/dark-v11';
const chartWidth = Math.max(320, Dimensions.get('window').width - 56);
const graphLabels = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

const BUILDING_TYPES = ['residential', 'office', 'school', 'hospital', 'park'];

const BUILDING_EFFECTS = {
  residential: { flow: 18, detour: 1.4, ecology: -0.7, social: 0.2, traffic: 0.9 },
  office: { flow: 14, detour: 1.1, ecology: -0.4, social: 0.4, traffic: 0.8 },
  school: { flow: 4, detour: 0.2, ecology: 0.1, social: 1.4, traffic: 0.2 },
  hospital: { flow: 6, detour: 0.3, ecology: -0.1, social: 1.2, traffic: 0.3 },
  park: { flow: -3, detour: -0.2, ecology: 1.2, social: 0.8, traffic: -0.3 },
};

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

function round1(value) {
  return Number(toNumber(value, 0).toFixed(1));
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

function buildCityImpact(buildings) {
  const impact = {
    total: 0,
    counts: {},
    flow: 0,
    detour: 0,
    ecology: 0,
    social: 0,
    traffic: 0,
  };

  if (!Array.isArray(buildings) || !buildings.length) return impact;

  buildings.forEach((item) => {
    const type = String(item?.type || '').toLowerCase();
    const next = BUILDING_EFFECTS[type];
    if (!next) return;

    impact.total += 1;
    impact.counts[type] = (impact.counts[type] || 0) + 1;
    impact.flow += next.flow;
    impact.detour += next.detour;
    impact.ecology += next.ecology;
    impact.social += next.social;
    impact.traffic += next.traffic;
  });

  impact.flow = Math.round(impact.flow);
  impact.detour = round1(impact.detour);
  impact.ecology = round1(impact.ecology);
  impact.social = round1(impact.social);
  impact.traffic = round1(impact.traffic);

  return impact;
}

function deriveCongestionLevel(trafficLoad) {
  if (trafficLoad >= 80) return 'severe';
  if (trafficLoad >= 60) return 'high';
  if (trafficLoad >= 40) return 'medium';
  return 'low';
}

function applyImpactToOverview(overview, impact) {
  if (!overview) return null;

  const baseFlow = toNumber(overview?.base_flow_vehicles_per_hour, 0);
  const baseDetour = toNumber(overview?.detour_increase_percent, 0);
  const baseEcology = toNumber(overview?.city_metrics?.ecology, 0);
  const baseSocial = toNumber(overview?.city_metrics?.social_score, 0);
  const baseTrafficLoad = toNumber(overview?.city_metrics?.traffic_load, 0);

  const flow = Math.max(0, Math.round(baseFlow + toNumber(impact?.flow, 0)));
  const detour = Math.max(0, round1(baseDetour + toNumber(impact?.detour, 0)));
  const ecology = Math.round(clamp(baseEcology + toNumber(impact?.ecology, 0), 0, 100));
  const social = Math.round(clamp(baseSocial + toNumber(impact?.social, 0), 0, 100));
  const trafficLoad = Math.round(clamp(baseTrafficLoad + toNumber(impact?.traffic, 0), 0, 100));

  return {
    ...overview,
    base_flow_vehicles_per_hour: flow,
    detour_increase_percent: detour,
    congestion_level: deriveCongestionLevel(trafficLoad),
    city_metrics: {
      ...(overview.city_metrics || {}),
      ecology,
      social_score: social,
      traffic_load: trafficLoad,
    },
  };
}

function markerCategoryByBuilding(type) {
  if (type === 'school') return 'education';
  if (type === 'hospital') return 'medical';
  if (type === 'park') return 'park';
  if (type === 'office') return 'commercial';
  return 'general';
}

function SectionCard({ title, children }) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ActionButton({ label, onPress, danger, disabled, small, active }) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.actionButton,
        small && styles.actionButtonSmall,
        danger && styles.actionButtonDanger,
        active && styles.actionButtonActive,
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
  const [mapTheme, setMapTheme] = useState('dark');
  const [terrainEnabled, setTerrainEnabled] = useState(true);

  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [route, setRoute] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [lastMapTap, setLastMapTap] = useState(null);

  const [modeOptions, setModeOptions] = useState([]);
  const [modesBusy, setModesBusy] = useState(false);
  const [recommendedMode, setRecommendedMode] = useState('');
  const [selectedMode, setSelectedMode] = useState('');

  const [buildMode, setBuildMode] = useState(false);
  const [buildingType, setBuildingType] = useState('residential');
  const [buildings, setBuildings] = useState([]);

  const [transportOverview, setTransportOverview] = useState(null);

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

  const cityImpact = useMemo(() => buildCityImpact(buildings), [buildings]);

  const effectiveOverview = useMemo(
    () => applyImpactToOverview(transportOverview, cityImpact),
    [transportOverview, cityImpact]
  );

  const chartData = useMemo(() => buildChartData(effectiveOverview), [effectiveOverview]);

  const buildingMix = useMemo(() => {
    return BUILDING_TYPES.map((type) => {
      const count = cityImpact.counts[type] || 0;
      if (!count) return null;
      return `${t(`map.building.${type}`)}: ${count}`;
    })
      .filter(Boolean)
      .join(' | ');
  }, [cityImpact.counts, t]);

  const loadTransportOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/api/simulation/transport/overview', { headers: authHeaders });
      const next = response.data || {};
      setTransportOverview(next);
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
    setModeOptions([]);
    setSelectedMode('');
    setRecommendedMode('');
    setLastMapTap(null);
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
      setDestination(null);
      setRoute([]);
      setRouteInfo(null);
      setModeOptions([]);
      setSelectedMode('');
      setRecommendedMode('');
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
    async (from, to, mode) => {
      if (!from || !to) return;

      const normalizedMode = mode || 'driving';
      setRouteBusy(true);
      setRouteError('');

      try {
        const response = await api.post(
          '/api/routes/optimize',
          {
            origin: [from.longitude, from.latitude],
            destination: [to.longitude, to.latitude],
            transport_mode: normalizedMode,
            include_traffic_prediction: true,
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
        setSelectedMode(normalizedMode);
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

  const requestModeOptions = useCallback(
    async (from, to) => {
      if (!from || !to) return;

      setModesBusy(true);
      setRouteError('');

      try {
        const response = await api.post(
          '/api/routes/modes',
          {
            origin: [from.longitude, from.latitude],
            destination: [to.longitude, to.latitude],
            modes: ['driving', 'walking', 'cycling'],
            include_traffic_prediction: true,
          },
          { headers: authHeaders }
        );

        const payload = response.data || {};
        const options = Array.isArray(payload.options) ? payload.options : [];
        const best = payload.recommended_mode || options[0]?.mode || 'driving';

        setModeOptions(options);
        setRecommendedMode(best);
        setSelectedMode(best);
        setLastAction(t('map.status.recommended_mode', { mode: t(`map.mode.${best}`) }));

        await buildRoute(from, to, best);
      } catch (e) {
        setModeOptions([]);
        setRecommendedMode('');
        setSelectedMode('');
        setRoute([]);
        setRouteInfo(null);
        setRouteError(parseError(e, t('common.request_failed')));
        setLastAction(t('map.status.mode_pick_failed'));
      } finally {
        setModesBusy(false);
      }
    },
    [authHeaders, buildRoute, t]
  );

  const onModeSelect = useCallback(
    (mode) => {
      if (!origin || !destination || !mode) return;
      setSelectedMode(mode);
      buildRoute(origin, destination, mode).catch(() => null);
    },
    [origin, destination, buildRoute]
  );

  const addBuilding = useCallback(
    (coords) => {
      const latitude = toNumber(coords?.latitude, NaN);
      const longitude = toNumber(coords?.longitude, NaN);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

      const next = {
        id: `${Date.now()}-${Math.round(Math.random() * 100000)}`,
        type: buildingType,
        latitude,
        longitude,
      };

      setBuildings((prev) => [...prev, next]);
      setLastAction(t('map.status.building_added', { type: t(`map.building.${buildingType}`) }));
    },
    [buildingType, t]
  );

  const undoBuilding = useCallback(() => {
    setBuildings((prev) => {
      if (!prev.length) return prev;
      const next = prev.slice(0, -1);
      return next;
    });
    setLastAction(t('map.status.building_removed'));
  }, [t]);

  const clearBuildings = useCallback(() => {
    setBuildings([]);
    setLastAction(t('map.status.buildings_cleared'));
  }, [t]);

  const onMapPress = useCallback(
    (coords) => {
      if (routeBusy || modesBusy) return;

      const latitude = toNumber(coords?.latitude, NaN);
      const longitude = toNumber(coords?.longitude, NaN);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

      const clicked = { latitude, longitude, source: 'map' };
      setLastMapTap(clicked);
      setRouteError('');

      if (buildMode) {
        addBuilding(clicked);
        return;
      }

      if (!origin) {
        setOrigin({ ...clicked, source: 'manual' });
        setDestination(null);
        setRoute([]);
        setRouteInfo(null);
        setModeOptions([]);
        setSelectedMode('');
        setRecommendedMode('');
        setLastAction(t('map.status.start_set_tap_b'));
        return;
      }

      setDestination(clicked);
      setLastAction(t('map.status.selecting_modes'));
      requestModeOptions(origin, clicked).catch(() => null);
    },
    [origin, destination, buildMode, addBuilding, modesBusy, routeBusy, requestModeOptions, t]
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

    buildings.forEach((building) => {
      points.push({
        id: `building-${building.id}`,
        name: t('map.point.building', { type: t(`map.building.${building.type}`) }),
        category: markerCategoryByBuilding(building.type),
        latitude: building.latitude,
        longitude: building.longitude,
      });
    });

    return points;
  }, [origin, destination, buildings, t]);

  const buildLocalAgentReply = useCallback(
    (prompt, overview = effectiveOverview) => {
      const text = String(prompt || '').toLowerCase();
      const flow = toNumber(overview?.base_flow_vehicles_per_hour, 0);
      const detour = toNumber(overview?.detour_increase_percent, 0);
      const ecology = toNumber(overview?.city_metrics?.ecology, 0);

      if (/здан|building|парк|school|школ/.test(text)) {
        return t('ai.fallback.buildings', {
          count: cityImpact.total,
          flow: cityImpact.flow,
          ecology: cityImpact.ecology,
        });
      }

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
    [cityImpact, effectiveOverview, t]
  );

  const submitAiPrompt = async () => {
    const prompt = aiInput.trim();
    if (!prompt || aiBusy) return;

    setAiInput('');
    setAiBusy(true);

    const nextMessages = [...aiMessages, { role: 'user', text: prompt }];
    setAiMessages(nextMessages);

    try {
      const baseOverview = await loadTransportOverview();
      const mergedOverview = applyImpactToOverview(baseOverview, cityImpact);
      const mergedChart = buildChartData(mergedOverview);
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
            transport_overview: mergedOverview,
            graph_snapshot: mergedChart,
            map_terrain_enabled: terrainEnabled,
            route_mode_options: modeOptions,
            selected_mode: selectedMode || null,
            recommended_mode: recommendedMode || null,
            buildings,
            building_impact: cityImpact,
            last_map_tap: lastMapTap,
            guest_mode: Boolean(isGuest),
          },
        },
        { headers: authHeaders }
      );

      setAiMessages((prev) => [
        ...prev,
        { role: 'assistant', text: response.data?.answer || buildLocalAgentReply(prompt, mergedOverview) },
      ]);
    } catch {
      setAiMessages((prev) => [...prev, { role: 'assistant', text: buildLocalAgentReply(prompt) }]);
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
        <Map3D
          points={mapPoints}
          route={route}
          apiKey={MAPBOX_ACCESS_TOKEN}
          mapboxStyleLight={MAPBOX_STYLE_LIGHT}
          mapboxStyleDark={MAPBOX_STYLE_DARK}
          terrainEnabled={terrainEnabled}
          theme={mapTheme}
          onMapPress={onMapPress}
          style={styles.map}
        />
      </View>

      <View style={styles.mapInfoRow}>
        <Text style={styles.statsText}>
          {t('map.mapbox_token')}: {MAPBOX_ACCESS_TOKEN ? t('map.active') : t('map.missing')}
        </Text>
        <Text style={styles.statsText}>
          {t('map.congestion')}: {effectiveOverview?.congestion_level || t('common.unknown')}
        </Text>
        {loading ? <ActivityIndicator size="small" color="#a78bfa" /> : null}
        {routeBusy || modesBusy ? <ActivityIndicator size="small" color="#22d3ee" /> : null}
        <ActionButton
          label={mapTheme === 'dark' ? t('map.theme.light') : t('map.theme.dark')}
          onPress={() => setMapTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
          small
        />
        <ActionButton
          label={showPredictions ? t('map.hide_graph') : t('map.show_graph')}
          onPress={() => setShowPredictions((v) => !v)}
          small
        />
      </View>

      <View style={styles.mapInfoRow}>
        <ActionButton
          label={terrainEnabled ? t('map.terrain_on') : t('map.terrain_off')}
          onPress={() => setTerrainEnabled((prev) => !prev)}
          small
        />
        <ActionButton
          label={buildMode ? t('map.build_mode_off') : t('map.build_mode_on')}
          onPress={() => {
            setBuildMode((prev) => {
              const next = !prev;
              setLastAction(next ? t('map.status.build_mode_on') : t('map.status.build_mode_off'));
              return next;
            });
          }}
          active={buildMode}
          small
        />
        <ActionButton
          label={t('map.undo_building')}
          onPress={undoBuilding}
          disabled={!buildings.length}
          small
        />
        <ActionButton
          label={t('map.clear_buildings')}
          onPress={clearBuildings}
          disabled={!buildings.length}
          danger
          small
        />
      </View>

      {buildMode ? (
        <View style={styles.mapInfoRow}>
          <Text style={styles.statsText}>{t('map.build_type')}:</Text>
          {BUILDING_TYPES.map((type) => (
            <ActionButton
              key={type}
              label={t(`map.building.${type}`)}
              onPress={() => setBuildingType(type)}
              active={buildingType === type}
              small
            />
          ))}
        </View>
      ) : null}

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
          disabled={routeBusy || modesBusy}
          small
        />
        <ActionButton
          label={t('map.reset_ab')}
          onPress={resetNavigation}
          danger
          disabled={routeBusy || modesBusy}
          small
        />
      </View>

      {modeOptions.length ? (
        <View style={styles.impactCard}>
          <Text style={styles.impactText}>
            {t('map.route_mode_title')}: {t(`map.mode.${recommendedMode || modeOptions[0]?.mode || 'driving'}`)}
          </Text>
          <View style={styles.modeRow}>
            {modeOptions.map((option) => {
              const mode = option?.mode || 'driving';
              const minutes = Math.round(
                toNumber(option?.duration_with_traffic_minutes, option?.duration_minutes || 0)
              );

              return (
                <ActionButton
                  key={mode}
                  label={`${t(`map.mode.${mode}`)} · ${minutes}${t('map.min_short')}`}
                  onPress={() => onModeSelect(mode)}
                  active={selectedMode === mode}
                  small
                />
              );
            })}
          </View>
        </View>
      ) : null}

      {routeInfo ? (
        <Text style={styles.metaText}>
          {t('map.route_info', {
            km: toNumber(routeInfo.distance_km, 0),
            min: Math.round(
              toNumber(routeInfo.duration_with_traffic_minutes, routeInfo.duration_minutes || 0)
            ),
          })}{' '}
          • {t('map.mode_label')}: {t(`map.mode.${selectedMode || 'driving'}`)}
        </Text>
      ) : null}

      {buildings.length ? (
        <View style={styles.impactCard}>
          <Text style={styles.impactText}>
            {t('map.buildings_count', { count: cityImpact.total })}
            {buildingMix ? ` | ${buildingMix}` : ''}
          </Text>
          <Text style={styles.metaText}>
            {t('map.buildings_impact', {
              flow: cityImpact.flow,
              detour: cityImpact.detour,
              ecology: cityImpact.ecology,
              social: cityImpact.social,
            })}
          </Text>
        </View>
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

            {effectiveOverview ? (
              <View style={styles.impactCard}>
                <Text style={styles.impactText}>
                  {t('map.flow')}: {effectiveOverview.base_flow_vehicles_per_hour} {t('map.vehicles_per_hour')} |{' '}
                  {t('map.detour')}: {effectiveOverview.detour_increase_percent}% | {t('map.congestion')}:{' '}
                  {effectiveOverview.congestion_level}
                </Text>
                <Text style={styles.metaText}>
                  {t('map.metric.ecology')}: {effectiveOverview?.city_metrics?.ecology} |{' '}
                  {t('map.metric.traffic')}: {effectiveOverview?.city_metrics?.traffic_load} |{' '}
                  {t('map.metric.social')}: {effectiveOverview?.city_metrics?.social_score}
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
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
    gap: 6,
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
  actionButtonActive: {
    borderColor: '#22d3ee',
    backgroundColor: '#0f766e',
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
