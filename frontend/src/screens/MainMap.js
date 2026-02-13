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
import { LineChart, PieChart } from 'react-native-chart-kit';

import api from '../api';
import Map3D from '../components/Map3D';

const DGIS_KEY = process.env.EXPO_PUBLIC_DGIS_KEY || '';

const impactTypes = ['park', 'school', 'factory', 'residential', 'bridge'];
const categoryOptions = ['education', 'park', 'medical', 'commercial', 'bridge', 'factory'];
const demandOptions = [80, 120, 160, 220];
const timeWindowOptions = [
  { id: '8-18', label: '08:00 - 18:00', start: '08:00', end: '18:00' },
  { id: '9-17', label: '09:00 - 17:00', start: '09:00', end: '17:00' },
  { id: 'full', label: '00:00 - 23:59', start: '00:00', end: '23:59' },
];

const nameTemplates = {
  education: ['School Cluster', 'NIS Node', 'Campus Point'],
  park: ['Green Hub', 'Eco Park', 'Public Garden'],
  medical: ['Health Center', 'Clinic Point', 'Medical Hub'],
  commercial: ['Trade Center', 'Retail Node', 'Market Point'],
  bridge: ['Bridge Control', 'River Crossing', 'Transit Link'],
  factory: ['Industry Block', 'Factory Node', 'Production Base'],
};

const chartWidth = Math.max(320, Dimensions.get('window').width - 56);

function parseError(error) {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => d?.msg || JSON.stringify(d)).join('; ');
  }
  return detail || error?.message || 'Request failed';
}

function normalizeMapObjects(list) {
  if (!Array.isArray(list)) return [];

  return list
    .map((item, index) => {
      const latitude = Number(item?.location?.lat);
      const longitude = Number(item?.location?.lng);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

      return {
        id: String(item?.id ?? `map-${index}`),
        name: item?.name || 'Point',
        category: item?.type || 'general',
        description: item?.properties ? JSON.stringify(item.properties) : '',
        latitude,
        longitude,
      };
    })
    .filter(Boolean);
}

function compactValue(value) {
  if (Array.isArray(value)) return `${value.length} items`;
  if (value && typeof value === 'object') {
    if (value.simulation_id) return `simulation ${value.simulation_id.slice(0, 8)}`;
    if (value.id) return `id ${String(value.id).slice(0, 12)}`;
    if (value.message) return value.message;
    return 'done';
  }
  return String(value);
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

function ChoiceChip({ label, selected, onPress }) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.chipPressed,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export default function MainMap({ token, onLogout, isGuest = false }) {
  const [mapObjects, setMapObjects] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [deliveryPoints, setDeliveryPoints] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [results, setResults] = useState([]);
  const [user, setUser] = useState(null);

  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedPointId, setSelectedPointId] = useState('');
  const [selectedScenarioId, setSelectedScenarioId] = useState('');
  const [selectedResultId, setSelectedResultId] = useState('');
  const [selectedImpactType, setSelectedImpactType] = useState('park');

  const [isAddMode, setIsAddMode] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [pickedCoords, setPickedCoords] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(categoryOptions[0]);
  const [selectedTemplate, setSelectedTemplate] = useState(nameTemplates[categoryOptions[0]][0]);
  const [selectedDemand, setSelectedDemand] = useState(demandOptions[0]);
  const [selectedWindow, setSelectedWindow] = useState(timeWindowOptions[0]);

  const [busy, setBusy] = useState(false);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [error, setError] = useState('');
  const [lastAction, setLastAction] = useState('Waiting for action');

  const [showPredictions, setShowPredictions] = useState(false);
  const [impactForecast, setImpactForecast] = useState(null);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessages, setAiMessages] = useState([
    {
      role: 'assistant',
      text:
        'Я агент сценариев. Спроси: "Что будет, если перекрыть мост на ремонт?"',
    },
  ]);

  const authHeaders = useMemo(() => {
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  const currentVehicle = useMemo(
    () => vehicles.find((v) => v.id === selectedVehicleId) || null,
    [vehicles, selectedVehicleId]
  );

  const templateOptions = useMemo(() => nameTemplates[selectedCategory] || [], [selectedCategory]);

  useEffect(() => {
    if (templateOptions.length && !templateOptions.includes(selectedTemplate)) {
      setSelectedTemplate(templateOptions[0]);
    }
  }, [templateOptions, selectedTemplate]);

  const setActionSummary = (label, data) => {
    setLastAction(`${label}: ${compactValue(data)}`);
  };

  const runAction = async (label, handler, options = {}) => {
    const { silent = false } = options;

    if (!silent) {
      setBusy(true);
      setError('');
    }

    try {
      const data = await handler();
      if (!silent) setActionSummary(label, data);
      return data;
    } catch (e) {
      const message = parseError(e);
      if (!silent) {
        setError(message);
        setLastAction(`${label}: failed`);
      }
      throw e;
    } finally {
      if (!silent) setBusy(false);
    }
  };

  const fetchMapObjects = useCallback(async () => {
    const response = await api.get('/api/objects/map/all', { headers: authHeaders });
    const next = Array.isArray(response.data) ? response.data : [];
    setMapObjects(next);
    return next;
  }, [authHeaders]);

  const fetchVehicles = useCallback(async () => {
    const response = await api.get('/api/objects/vehicles', { headers: authHeaders });
    const next = Array.isArray(response.data) ? response.data : [];
    setVehicles(next);
    if (next.length && !next.find((v) => v.id === selectedVehicleId)) {
      setSelectedVehicleId(next[0].id);
    }
    if (!next.length) setSelectedVehicleId('');
    return next;
  }, [authHeaders, selectedVehicleId]);

  const fetchDeliveryPoints = useCallback(async () => {
    const response = await api.get('/api/objects/delivery-points', { headers: authHeaders });
    const next = Array.isArray(response.data) ? response.data : [];
    setDeliveryPoints(next);
    if (next.length && !next.find((p) => p.id === selectedPointId)) {
      setSelectedPointId(next[0].id);
    }
    if (!next.length) setSelectedPointId('');
    return next;
  }, [authHeaders, selectedPointId]);

  const fetchScenarios = useCallback(async () => {
    const response = await api.get('/api/scenarios', { headers: authHeaders });
    const next = Array.isArray(response.data) ? response.data : [];
    setScenarios(next);
    if (next.length && !next.find((s) => s.id === selectedScenarioId)) {
      setSelectedScenarioId(next[0].id);
    }
    if (!next.length) setSelectedScenarioId('');
    return next;
  }, [authHeaders, selectedScenarioId]);

  const fetchResults = useCallback(async () => {
    const response = await api.get('/api/simulation/results', { headers: authHeaders });
    const next = Array.isArray(response.data) ? response.data : [];
    setResults(next);
    if (next.length && !next.find((r) => r.simulation_id === selectedResultId)) {
      setSelectedResultId(next[0].simulation_id);
    }
    if (!next.length) setSelectedResultId('');
    return next;
  }, [authHeaders, selectedResultId]);

  const fetchMe = useCallback(async () => {
    const response = await api.get('/api/auth/me', { headers: authHeaders });
    setUser(response.data || null);
    return response.data;
  }, [authHeaders]);

  const refreshSnapshot = useCallback(async () => {
    setLoadingSnapshot(true);
    setError('');

    try {
      await Promise.all([
        fetchMapObjects(),
        fetchVehicles(),
        fetchDeliveryPoints(),
        fetchScenarios(),
        fetchResults(),
      ]);
      setLastAction('Snapshot refreshed');
    } catch (e) {
      setError(parseError(e));
    } finally {
      setLoadingSnapshot(false);
    }
  }, [fetchMapObjects, fetchVehicles, fetchDeliveryPoints, fetchScenarios, fetchResults]);

  useEffect(() => {
    refreshSnapshot();
  }, [refreshSnapshot]);

  const createDemoVehicle = () =>
    runAction('Create vehicle', async () => {
      const payload = {
        id: '',
        name: `Vehicle-${Date.now().toString().slice(-5)}`,
        capacity: 120,
        current_location: { lat: 49.95, lng: 82.61 },
        status: 'idle',
        route: [],
      };

      const response = await api.post('/api/objects/vehicles', payload, { headers: authHeaders });
      await Promise.all([fetchVehicles(), fetchMapObjects()]);
      return response.data;
    });

  const toggleSelectedVehicleStatus = () => {
    if (!currentVehicle) return;

    runAction('Update vehicle', async () => {
      const nextStatus = currentVehicle.status === 'moving' ? 'idle' : 'moving';
      const payload = {
        ...currentVehicle,
        status: nextStatus,
        route: Array.isArray(currentVehicle.route) ? currentVehicle.route : [],
      };

      const response = await api.put(`/api/objects/vehicles/${currentVehicle.id}`, payload, {
        headers: authHeaders,
      });

      await Promise.all([fetchVehicles(), fetchMapObjects()]);
      return response.data;
    });
  };

  const deleteSelectedVehicle = () => {
    if (!selectedVehicleId) return;

    runAction('Delete vehicle', async () => {
      const response = await api.delete(`/api/objects/vehicles/${selectedVehicleId}`, {
        headers: authHeaders,
      });
      await Promise.all([fetchVehicles(), fetchMapObjects()]);
      return response.data;
    });
  };

  const deleteSelectedPoint = () => {
    if (!selectedPointId) return;

    runAction('Delete point', async () => {
      const response = await api.delete(`/api/objects/delivery-points/${selectedPointId}`, {
        headers: authHeaders,
      });
      await Promise.all([fetchDeliveryPoints(), fetchMapObjects()]);
      return response.data;
    });
  };

  const handleMapPress = (coords) => {
    if (!isAddMode) return;
    setPickedCoords(coords);
    setAddModalVisible(true);
  };

  const savePickedPoint = () => {
    if (!pickedCoords) return;

    runAction('Create point', async () => {
      const payload = {
        id: '',
        name: `${selectedTemplate} [${selectedCategory}]`,
        location: {
          lat: Number(pickedCoords.latitude),
          lng: Number(pickedCoords.longitude),
        },
        demand: selectedDemand,
        time_window_start: selectedWindow.start,
        time_window_end: selectedWindow.end,
      };

      const response = await api.post('/api/objects/delivery-points', payload, { headers: authHeaders });
      setAddModalVisible(false);
      setIsAddMode(false);
      await Promise.all([fetchDeliveryPoints(), fetchMapObjects()]);
      return response.data;
    });
  };

  const createScenarioFromSelection = () => {
    if (!selectedVehicleId || !selectedPointId) {
      setError('Select one vehicle and one delivery point');
      return;
    }

    runAction('Create scenario', async () => {
      const payload = {
        name: `Scenario-${Date.now().toString().slice(-5)}`,
        description: 'Generated from interface',
        influence_point_ids: [],
        vehicle_ids: [selectedVehicleId],
        delivery_point_ids: [selectedPointId],
        start_time: new Date().toISOString(),
        duration_hours: 8,
      };

      const response = await api.post('/api/scenarios', payload, { headers: authHeaders });
      await fetchScenarios();
      return response.data;
    });
  };

  const runSelectedScenario = () => {
    if (!selectedScenarioId) return;

    runAction('Run scenario', async () => {
      const response = await api.post(`/api/simulation/run-scenario/${selectedScenarioId}`, {}, {
        headers: authHeaders,
      });
      await fetchResults();
      return response.data;
    });
  };

  const deleteSelectedScenario = () => {
    if (!selectedScenarioId) return;

    runAction('Delete scenario', async () => {
      const response = await api.delete(`/api/scenarios/${selectedScenarioId}`, { headers: authHeaders });
      await fetchScenarios();
      return response.data;
    });
  };

  const runImpactCheck = () =>
    runAction('Impact check', async () => {
      const response = await api.get(`/api/simulation/impact?object_type=${selectedImpactType}`, {
        headers: authHeaders,
      });
      setImpactForecast(response.data || null);
      return response.data;
    });

  const runQuickSimulation = () =>
    runAction('Quick simulation', async () => {
      const selectedVehicles = vehicles.length ? [vehicles[0]] : [];
      const selectedPoints = deliveryPoints.slice(0, 3);

      if (!selectedVehicles.length) {
        throw new Error('No vehicles available. Create one first.');
      }
      if (!selectedPoints.length) {
        throw new Error('No delivery points available. Add points first.');
      }

      const payload = {
        vehicles: selectedVehicles,
        delivery_points: selectedPoints,
        start_time: new Date().toISOString(),
        duration_hours: 6,
      };

      const response = await api.post('/api/simulation/run', payload, { headers: authHeaders });
      await fetchResults();
      return response.data;
    });

  const deleteSelectedResult = () => {
    if (!selectedResultId) return;

    runAction('Delete simulation result', async () => {
      const response = await api.delete(`/api/simulation/results/${selectedResultId}`, {
        headers: authHeaders,
      });
      await fetchResults();
      return response.data;
    });
  };

  const selectedResult = useMemo(
    () => results.find((r) => r.simulation_id === selectedResultId) || results[0] || null,
    [results, selectedResultId]
  );

  const chartData = useMemo(() => {
    if (!selectedResult?.steps?.length) {
      return {
        labels: ['T1', 'T2', 'T3'],
        traffic: [20, 35, 30],
        ecology: [75, 68, 72],
        social: [60, 64, 66],
      };
    }

    const steps = selectedResult.steps;
    const labels = steps.map((_, idx) => `T${idx + 1}`).slice(0, 8);
    const traffic = steps.slice(0, 8).map((s) => Number(s?.metrics?.traffic_load || 0));
    const ecology = steps.slice(0, 8).map((s) => Number(s?.metrics?.ecology || 0));
    const social = steps.slice(0, 8).map((s) => Number(s?.metrics?.social_score || 0));

    return { labels, traffic, ecology, social };
  }, [selectedResult]);

  const pieData = useMemo(() => {
    const counts = {};
    mapObjects.forEach((item) => {
      const key = item?.type || 'other';
      counts[key] = (counts[key] || 0) + 1;
    });

    const palette = ['#8b5cf6', '#ec4899', '#22d3ee', '#f59e0b', '#a3e635', '#fb7185'];

    return Object.keys(counts).map((key, index) => ({
      name: key,
      population: counts[key],
      color: palette[index % palette.length],
      legendFontColor: '#d8d4ff',
      legendFontSize: 11,
    }));
  }, [mapObjects]);

  const mapPoints = useMemo(() => normalizeMapObjects(mapObjects), [mapObjects]);

  const getTrafficFlow = async (bridgeId) => {
    const [mapResponse, vehiclesResponse] = await Promise.all([
      api.get('/api/objects/map/all', { headers: authHeaders }),
      api.get('/api/objects/vehicles', { headers: authHeaders }),
    ]);

    const objects = Array.isArray(mapResponse.data) ? mapResponse.data : [];
    const bridge =
      objects.find((o) => o.id === bridgeId) ||
      objects.find((o) => /мост|bridge/i.test(String(o.name || '')));

    const vehicleList = Array.isArray(vehiclesResponse.data) ? vehiclesResponse.data : [];
    const moving = vehicleList.filter((v) => v.status === 'moving').length;
    const total = vehicleList.length || 1;
    const movingRatio = moving / total;

    const baseFlow = Math.round(120 + movingRatio * 140 + vehicleList.length * 10);
    const detourIncrease = Math.round(28 + movingRatio * 24);

    return {
      bridge_id: bridge?.id || bridgeId || 'unknown-bridge',
      bridge_name: bridge?.name || 'Мост',
      base_flow_vehicles_per_hour: baseFlow,
      detour_increase_percent: detourIncrease,
    };
  };

  const buildLocalAgentReply = (prompt) => {
    const text = String(prompt || '').toLowerCase();

    if (/мост|bridge/.test(text)) {
      return (
        'Если перекрыть мост на ремонт, нагрузка на объездные маршруты вырастет. ' +
        'Рекомендация: включить реверсивное движение и вынести грузовой поток за пределы часа пик.'
      );
    }

    if (/пробк|traffic|трафик/.test(text)) {
      return (
        'По локальному прогнозу трафик на главных узлах вырастет в пиковые часы. ' +
        'Рекомендация: временно перенастроить светофоры и добавить приоритет общественному транспорту.'
      );
    }

    if (/эколог|air|выброс/.test(text)) {
      return (
        'По локальному сценарию без дополнительных мер экологическая нагрузка растет. ' +
        'Рекомендация: ограничить транзит через перегруженные районы и усилить фильтрацию на промзонах.'
      );
    }

    return (
      'Работаю в локальном режиме агента. Могу оценить трафик, мосты, экологию и сценарии. ' +
      'Спроси, например: "Что будет, если перекрыть мост на ремонт?"'
    );
  };

  const submitAiPrompt = async () => {
    const prompt = aiInput.trim();
    if (!prompt || aiBusy) return;

    setAiInput('');
    setAiBusy(true);

    const nextMessages = [...aiMessages, { role: 'user', text: prompt }];
    setAiMessages(nextMessages);

    try {
      let context = {};
      if (/мост|bridge/i.test(prompt)) {
        try {
          const trafficFlow = await getTrafficFlow(selectedPointId || undefined);
          context = { traffic_flow: trafficFlow };
        } catch {
          context = {};
        }
      }

      const history = nextMessages
        .slice(-9, -1)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.text }));

      const response = await api.post(
        '/api/ai/predict',
        {
          prompt,
          history,
          context,
        },
        { headers: authHeaders }
      );

      setAiMessages((prev) => [
        ...prev,
        { role: 'assistant', text: response.data?.answer || buildLocalAgentReply(prompt) },
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
          <Text style={styles.subtitle}>Dark control center</Text>
        </View>

        <View style={styles.headerActions}>
          <ActionButton label="Refresh all" onPress={refreshSnapshot} disabled={busy || loadingSnapshot} small />
          <ActionButton label="Logout" onPress={onLogout} danger small />
        </View>
      </View>

      <View style={styles.mapWrap}>
        <Map3D points={mapPoints} apiKey={DGIS_KEY} onMapPress={handleMapPress} style={styles.map} />
      </View>

      <View style={styles.mapInfoRow}>
        <Text style={styles.statsText}>Map objects: {mapPoints.length}</Text>
        {loadingSnapshot ? <ActivityIndicator size="small" color="#a78bfa" /> : null}
        <ActionButton
          label={isAddMode ? 'Cancel add mode' : 'Add point on map'}
          onPress={() => setIsAddMode((v) => !v)}
          danger={isAddMode}
          disabled={busy}
          small
        />
        <ActionButton
          label={showPredictions ? 'Hide predictions' : 'Show predictions'}
          onPress={() => setShowPredictions((v) => !v)}
          small
        />
      </View>

      {isAddMode ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Add mode active: click on map to place delivery point.</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <ScrollView contentContainerStyle={styles.content}>
        {showPredictions ? (
          <SectionCard title="Prediction graphs">
            <Text style={styles.metaText}>Traffic / Ecology / Social trends</Text>
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
                legend: ['Traffic', 'Ecology', 'Social'],
              }}
              width={chartWidth}
              height={220}
              withShadow={false}
              withInnerLines
              chartConfig={stylesForCharts.line}
              style={styles.chart}
              bezier
            />

            {pieData.length ? (
              <PieChart
                data={pieData}
                width={chartWidth}
                height={210}
                chartConfig={stylesForCharts.pie}
                accessor="population"
                backgroundColor="transparent"
                paddingLeft="4"
                absolute
              />
            ) : null}

            {impactForecast ? (
              <View style={styles.impactCard}>
                <Text style={styles.impactText}>{impactForecast.message}</Text>
                <Text style={styles.metaText}>
                  Ecology: {impactForecast?.impact?.ecology} | Traffic: {impactForecast?.impact?.traffic_load} | Social: {impactForecast?.impact?.social_score}
                </Text>
              </View>
            ) : null}
          </SectionCard>
        ) : null}

        <SectionCard title="User">
          <View style={styles.row}>
            <ActionButton
              label={isGuest ? 'Guest mode enabled' : 'Load /api/auth/me'}
              onPress={() => runAction('Auth me', fetchMe)}
              disabled={busy || isGuest || !token}
            />
          </View>
          {user ? (
            <Text style={styles.metaText}>{user.username} ({user.email})</Text>
          ) : (
            <Text style={styles.metaText}>User profile not loaded</Text>
          )}
        </SectionCard>

        <SectionCard title="Objects">
          <View style={styles.row}>
            <ActionButton label="Load vehicles" onPress={() => runAction('List vehicles', fetchVehicles)} disabled={busy} />
            <ActionButton label="Load points" onPress={() => runAction('List points', fetchDeliveryPoints)} disabled={busy} />
            <ActionButton label="Create demo vehicle" onPress={createDemoVehicle} disabled={busy} />
          </View>

          <Text style={styles.label}>Vehicle selection</Text>
          <ScrollView horizontal contentContainerStyle={styles.chipsRow}>
            {vehicles.map((v) => (
              <ChoiceChip
                key={v.id}
                label={`${v.name} [${v.status}]`}
                selected={v.id === selectedVehicleId}
                onPress={() => setSelectedVehicleId(v.id)}
              />
            ))}
          </ScrollView>

          <View style={styles.row}>
            <ActionButton label="Toggle vehicle status" onPress={toggleSelectedVehicleStatus} disabled={busy || !selectedVehicleId} />
            <ActionButton label="Delete vehicle" onPress={deleteSelectedVehicle} danger disabled={busy || !selectedVehicleId} />
          </View>

          <Text style={styles.label}>Delivery point selection</Text>
          <ScrollView horizontal contentContainerStyle={styles.chipsRow}>
            {deliveryPoints.map((p) => (
              <ChoiceChip
                key={p.id}
                label={p.name}
                selected={p.id === selectedPointId}
                onPress={() => setSelectedPointId(p.id)}
              />
            ))}
          </ScrollView>

          <View style={styles.row}>
            <ActionButton label="Delete selected point" onPress={deleteSelectedPoint} danger disabled={busy || !selectedPointId} />
          </View>
        </SectionCard>

        <SectionCard title="Scenarios">
          <View style={styles.row}>
            <ActionButton label="Load scenarios" onPress={() => runAction('List scenarios', fetchScenarios)} disabled={busy} />
            <ActionButton
              label="Create from selected"
              onPress={createScenarioFromSelection}
              disabled={busy || !selectedVehicleId || !selectedPointId}
            />
          </View>

          <Text style={styles.label}>Scenario selection</Text>
          <ScrollView horizontal contentContainerStyle={styles.chipsRow}>
            {scenarios.map((s) => (
              <ChoiceChip
                key={s.id}
                label={s.name}
                selected={s.id === selectedScenarioId}
                onPress={() => setSelectedScenarioId(s.id)}
              />
            ))}
          </ScrollView>

          <View style={styles.row}>
            <ActionButton label="Run scenario" onPress={runSelectedScenario} disabled={busy || !selectedScenarioId} />
            <ActionButton label="Delete scenario" onPress={deleteSelectedScenario} danger disabled={busy || !selectedScenarioId} />
          </View>
        </SectionCard>

        <SectionCard title="Simulation">
          <Text style={styles.label}>Impact type</Text>
          <View style={styles.chipsWrap}>
            {impactTypes.map((type) => (
              <ChoiceChip
                key={type}
                label={type}
                selected={selectedImpactType === type}
                onPress={() => setSelectedImpactType(type)}
              />
            ))}
          </View>

          <View style={styles.row}>
            <ActionButton label="Check impact" onPress={runImpactCheck} disabled={busy} />
            <ActionButton label="Run quick simulation" onPress={runQuickSimulation} disabled={busy} />
            <ActionButton label="Load results" onPress={() => runAction('List results', fetchResults)} disabled={busy} />
          </View>

          <Text style={styles.label}>Result selection</Text>
          <ScrollView horizontal contentContainerStyle={styles.chipsRow}>
            {results.map((r) => (
              <ChoiceChip
                key={r.simulation_id}
                label={r.simulation_id.slice(0, 8)}
                selected={r.simulation_id === selectedResultId}
                onPress={() => setSelectedResultId(r.simulation_id)}
              />
            ))}
          </ScrollView>

          <View style={styles.row}>
            <ActionButton label="Delete result" onPress={deleteSelectedResult} danger disabled={busy || !selectedResultId} />
          </View>
        </SectionCard>

        <SectionCard title="System status">
          <Text style={styles.metaText}>{lastAction}</Text>
        </SectionCard>
      </ScrollView>

      <Pressable style={styles.aiFab} onPress={() => setAiOpen(true)}>
        <Text style={styles.aiFabText}>AI Agent</Text>
      </Pressable>

      <Modal visible={addModalVisible} transparent animationType="slide" onRequestClose={() => setAddModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create delivery point</Text>
            <Text style={styles.coordsText}>
              lat: {pickedCoords?.latitude?.toFixed?.(6)} | lng: {pickedCoords?.longitude?.toFixed?.(6)}
            </Text>

            <Text style={styles.label}>Category</Text>
            <View style={styles.chipsWrap}>
              {categoryOptions.map((category) => (
                <ChoiceChip
                  key={category}
                  label={category}
                  selected={selectedCategory === category}
                  onPress={() => setSelectedCategory(category)}
                />
              ))}
            </View>

            <Text style={styles.label}>Name template</Text>
            <View style={styles.chipsWrap}>
              {templateOptions.map((name) => (
                <ChoiceChip
                  key={name}
                  label={name}
                  selected={selectedTemplate === name}
                  onPress={() => setSelectedTemplate(name)}
                />
              ))}
            </View>

            <Text style={styles.label}>Demand</Text>
            <View style={styles.chipsWrap}>
              {demandOptions.map((demand) => (
                <ChoiceChip
                  key={String(demand)}
                  label={String(demand)}
                  selected={selectedDemand === demand}
                  onPress={() => setSelectedDemand(demand)}
                />
              ))}
            </View>

            <Text style={styles.label}>Time window</Text>
            <View style={styles.chipsWrap}>
              {timeWindowOptions.map((windowOption) => (
                <ChoiceChip
                  key={windowOption.id}
                  label={windowOption.label}
                  selected={selectedWindow.id === windowOption.id}
                  onPress={() => setSelectedWindow(windowOption)}
                />
              ))}
            </View>

            <View style={styles.modalActions}>
              <ActionButton label="Cancel" onPress={() => setAddModalVisible(false)} danger />
              <ActionButton label="Save point" onPress={savePickedPoint} disabled={busy} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={aiOpen} transparent animationType="slide" onRequestClose={() => setAiOpen(false)}>
        <View style={styles.aiOverlay}>
          <View style={styles.aiPanel}>
            <View style={styles.aiHeader}>
              <Text style={styles.aiTitle}>AI Agent</Text>
              <ActionButton label="Close" onPress={() => setAiOpen(false)} danger small />
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
              placeholder='Например: Что будет, если перекрыть мост на ремонт?'
              placeholderTextColor="#b6a5ff"
              style={styles.aiInput}
              multiline
            />

            <ActionButton label={aiBusy ? 'Thinking...' : 'Send'} onPress={submitAiPrompt} disabled={aiBusy} />
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
  pie: {
    color: (opacity = 1) => `rgba(216, 212, 255, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(216, 212, 255, ${opacity})`,
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
  banner: {
    borderWidth: 1,
    borderColor: '#a78bfa',
    backgroundColor: '#1a1034',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  bannerText: {
    color: '#ddd6fe',
    fontWeight: '700',
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
    borderWidth: 1,
    borderColor: '#2e1065',
    borderRadius: 12,
    backgroundColor: '#120a27',
    padding: 10,
  },
  sectionTitle: {
    color: '#f5f3ff',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  actionButton: {
    backgroundColor: '#8b5cf6',
    borderWidth: 1,
    borderColor: '#5b21b6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  actionButtonSmall: {
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  actionButtonDanger: {
    backgroundColor: '#db2777',
    borderColor: '#9d174d',
  },
  actionButtonDisabled: {
    opacity: 0.45,
  },
  actionButtonPressed: {
    opacity: 0.82,
  },
  actionButtonText: {
    color: '#f5f3ff',
    fontWeight: '800',
    fontSize: 12,
  },
  label: {
    color: '#ddd6fe',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  chipsRow: {
    gap: 8,
    paddingBottom: 6,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#4c1d95',
    backgroundColor: '#1a1034',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipSelected: {
    borderColor: '#a78bfa',
    backgroundColor: '#3b1f74',
  },
  chipPressed: {
    opacity: 0.86,
  },
  chipText: {
    color: '#c4b5fd',
    fontSize: 12,
  },
  chipTextSelected: {
    color: '#f5f3ff',
    fontWeight: '700',
  },
  metaText: {
    color: '#c4b5fd',
    fontSize: 12,
  },
  chart: {
    marginVertical: 8,
    borderRadius: 12,
  },
  impactCard: {
    borderWidth: 1,
    borderColor: '#4c1d95',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#1a1034',
  },
  impactText: {
    color: '#f5f3ff',
    fontWeight: '700',
    marginBottom: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 4, 24, 0.82)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  modalCard: {
    backgroundColor: '#120a27',
    borderWidth: 1,
    borderColor: '#4c1d95',
    borderRadius: 16,
    padding: 14,
  },
  modalTitle: {
    color: '#f5f3ff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
  },
  coordsText: {
    color: '#c4b5fd',
    marginBottom: 8,
    fontSize: 12,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  aiFab: {
    position: 'absolute',
    left: 10,
    top: Platform.OS === 'web' ? 120 : 140,
    backgroundColor: '#9333ea',
    borderColor: '#5b21b6',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  aiFabText: {
    color: '#f5f3ff',
    fontWeight: '800',
    fontSize: 12,
  },
  aiOverlay: {
    flex: 1,
    backgroundColor: 'rgba(4, 2, 12, 0.6)',
    justifyContent: 'flex-end',
  },
  aiPanel: {
    height: '78%',
    backgroundColor: '#0f0822',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#4c1d95',
    padding: 12,
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  aiTitle: {
    color: '#f5f3ff',
    fontSize: 18,
    fontWeight: '800',
  },
  aiMessages: {
    flex: 1,
  },
  aiMessagesContent: {
    gap: 8,
    paddingBottom: 10,
  },
  aiBubble: {
    borderRadius: 12,
    padding: 10,
    maxWidth: '90%',
  },
  aiBubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#6d28d9',
  },
  aiBubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: '#1f1145',
    borderWidth: 1,
    borderColor: '#4c1d95',
  },
  aiBubbleText: {
    color: '#f5f3ff',
    fontSize: 13,
    lineHeight: 18,
  },
  aiInput: {
    minHeight: 72,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#5b21b6',
    backgroundColor: '#140b2b',
    borderRadius: 12,
    color: '#f5f3ff',
    padding: 10,
    textAlignVertical: 'top',
    marginBottom: 8,
  },
});
