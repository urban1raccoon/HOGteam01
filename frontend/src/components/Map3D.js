import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { useI18n } from '../i18n';

function parsePayload(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizePoints(points) {
  if (!Array.isArray(points)) return [];
  return points
    .map((p, idx) => {
      const latitude = Number(p?.latitude);
      const longitude = Number(p?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

      return {
        id: String(p?.id ?? `point-${idx}`),
        name: p?.name || 'Point',
        category: p?.category || 'general',
        description: p?.description || '',
        latitude,
        longitude,
      };
    })
    .filter(Boolean);
}

function normalizeRoute(route) {
  if (!Array.isArray(route)) return [];
  return route
    .map((point) => {
      if (Array.isArray(point) && point.length >= 2) {
        const longitude = Number(point[0]);
        const latitude = Number(point[1]);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
        return [longitude, latitude];
      }

      const longitude = Number(point?.longitude);
      const latitude = Number(point?.latitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return [longitude, latitude];
    })
    .filter(Boolean);
}

function normalizeHeatmapPoints(points) {
  if (!Array.isArray(points)) return [];

  return points
    .map((point) => {
      if (Array.isArray(point) && point.length >= 2) {
        const longitude = Number(point[0]);
        const latitude = Number(point[1]);
        const weight = Number(point[2] ?? 1);
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
        return {
          longitude,
          latitude,
          weight: Number.isFinite(weight) ? Math.max(0.01, weight) : 1,
        };
      }

      const longitude = Number(point?.longitude);
      const latitude = Number(point?.latitude);
      const weight = Number(point?.weight ?? 1);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
      return {
        longitude,
        latitude,
        weight: Number.isFinite(weight) ? Math.max(0.01, weight) : 1,
      };
    })
    .filter(Boolean);
}

function normalizeIsochrones(data) {
  if (!data || typeof data !== 'object') {
    return { type: 'FeatureCollection', features: [] };
  }

  const features = Array.isArray(data.features)
    ? data.features.filter((feature) => {
        const geometryType = feature?.geometry?.type;
        return geometryType === 'Polygon' || geometryType === 'MultiPolygon';
      })
    : [];

  return {
    type: 'FeatureCollection',
    features,
  };
}

function buildHtml({ apiKey, initialTheme, styleLight, styleDark }) {
  const safeKey = (apiKey || '').trim();
  const safeTheme = initialTheme === 'light' ? 'light' : 'dark';
  const safeStyleLight = (styleLight || '').trim() || 'mapbox://styles/mapbox/light-v11';
  const safeStyleDark = (styleDark || '').trim() || 'mapbox://styles/mapbox/dark-v11';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <style>
    html, body, #map {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #0b1020;
    }
  </style>
</head>
<body>
  <div id="map"></div>

  <script>
    const POINTS = [];
    const API_TOKEN = ${JSON.stringify(safeKey)};
    const MAPBOX_STYLE_LIGHT = ${JSON.stringify(safeStyleLight)};
    const MAPBOX_STYLE_DARK = ${JSON.stringify(safeStyleDark)};
    const MAPLIBRE_STYLE_LIGHT = 'https://demotiles.maplibre.org/style.json';
    const MAPLIBRE_STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

    let engine = null;
    let map = null;
    let markers = [];

    let pendingPoints = null;
    let pendingRoute = null;
    let pendingTheme = null;
    let pendingHeatmap = null;
    let pendingHeatmapVisible = null;
    let pendingTerrain = null;
    let pendingIsochrones = null;
    let pendingDrawMode = null;

    let currentTheme = ${JSON.stringify(safeTheme)};
    let currentPoints = [];
    let currentRoute = null;
    let currentHeatmap = [];
    let heatmapVisible = true;
    let terrainEnabled = true;
    let currentIsochrones = { type: 'FeatureCollection', features: [] };
    let drawEnabled = false;

    let drawControl = null;
    let drawControlAttached = false;
    let trafficAnnounced = false;
    let terrainAnnounced = false;

    function sendToHost(payload) {
      const msg = JSON.stringify(payload);
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(msg);
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(msg, '*');
      }
    }

    function normalizeTheme(incoming) {
      return incoming === 'light' ? 'light' : 'dark';
    }

    function getMapboxStyle(theme) {
      return theme === 'light' ? MAPBOX_STYLE_LIGHT : MAPBOX_STYLE_DARK;
    }

    function getMapLibreStyle(theme) {
      return theme === 'light' ? MAPLIBRE_STYLE_LIGHT : MAPLIBRE_STYLE_DARK;
    }

    function getMapLib() {
      if (engine === 'mapbox') return window.mapboxgl;
      if (engine === 'maplibre') return window.maplibregl;
      return null;
    }

    function makeDotColor(category) {
      const palette = {
        vehicle: '#60a5fa',
        education: '#38bdf8',
        park: '#4ade80',
        factory: '#f97316',
        medical: '#f43f5e',
        commercial: '#facc15',
        bridge: '#a78bfa',
        general: '#2dd4bf',
      };
      return palette[String(category || '').toLowerCase()] || '#2dd4bf';
    }

    function normalizeRouteCoordinates(incoming) {
      if (!Array.isArray(incoming)) return [];
      return incoming
        .map((point) => {
          if (Array.isArray(point) && point.length >= 2) {
            const lon = Number(point[0]);
            const lat = Number(point[1]);
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
            return [lon, lat];
          }

          const lon = Number(point && point.longitude);
          const lat = Number(point && point.latitude);
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
          return [lon, lat];
        })
        .filter(Boolean);
    }

    function normalizeHeatmap(incoming) {
      if (!Array.isArray(incoming)) return [];
      return incoming
        .map((point) => {
          if (Array.isArray(point) && point.length >= 2) {
            const lon = Number(point[0]);
            const lat = Number(point[1]);
            const weight = Number(point[2] || 1);
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
            return {
              longitude: lon,
              latitude: lat,
              weight: Number.isFinite(weight) ? Math.max(0.01, weight) : 1,
            };
          }

          const lon = Number(point && point.longitude);
          const lat = Number(point && point.latitude);
          const weight = Number(point && point.weight);
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
          return {
            longitude: lon,
            latitude: lat,
            weight: Number.isFinite(weight) ? Math.max(0.01, weight) : 1,
          };
        })
        .filter(Boolean);
    }

    function normalizeIsochronesFeatureCollection(incoming) {
      if (!incoming || typeof incoming !== 'object') {
        return { type: 'FeatureCollection', features: [] };
      }
      const features = Array.isArray(incoming.features)
        ? incoming.features.filter((feature) => {
            const type = feature && feature.geometry && feature.geometry.type;
            return type === 'Polygon' || type === 'MultiPolygon';
          })
        : [];

      return { type: 'FeatureCollection', features: features };
    }

    function clearMarkers() {
      markers.forEach((marker) => {
        if (!marker) return;
        if (typeof marker.remove === 'function') marker.remove();
      });
      markers = [];
    }

    function fitBounds(minLng, minLat, maxLng, maxLat) {
      if (!map) return;
      if (!(Number.isFinite(minLng) && Number.isFinite(maxLng) && Number.isFinite(minLat) && Number.isFinite(maxLat))) {
        return;
      }

      try {
        if (typeof map.fitBounds === 'function') {
          map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
            padding: 50,
            maxZoom: 15,
            duration: 400,
          });
        }
      } catch {
        // camera fit is best effort only.
      }
    }

    function fitToPoints(points) {
      if (!map || !points.length) return;

      const lngs = points.map((point) => point.longitude);
      const lats = points.map((point) => point.latitude);
      fitBounds(
        Math.min.apply(null, lngs),
        Math.min.apply(null, lats),
        Math.max.apply(null, lngs),
        Math.max.apply(null, lats)
      );
    }

    function setPoints(points) {
      currentPoints = Array.isArray(points) ? points : [];
      if (!map) {
        pendingPoints = currentPoints;
        return;
      }

      clearMarkers();

      const mapLib = getMapLib();
      if (!mapLib || !mapLib.Marker) {
        fitToPoints(currentPoints);
        return;
      }

      currentPoints.forEach((point) => {
        const marker = new mapLib.Marker({ color: makeDotColor(point.category) })
          .setLngLat([point.longitude, point.latitude]);

        if (point.name && mapLib.Popup) {
          marker.setPopup(new mapLib.Popup({ offset: 12 }).setText(point.name));
        }

        marker.addTo(map);
        markers.push(marker);
      });

      fitToPoints(currentPoints);
    }

    function removeLayerAndSource(layerId, sourceId) {
      if (!map) return;

      try {
        if (map.getLayer && map.getLayer(layerId)) {
          map.removeLayer(layerId);
        }
      } catch {
        // ignore layer cleanup errors
      }

      try {
        if (map.getSource && map.getSource(sourceId)) {
          map.removeSource(sourceId);
        }
      } catch {
        // ignore source cleanup errors
      }
    }

    function clearRoute() {
      removeLayerAndSource('route-line', 'route-source');
    }

    function fitToRoute(coordinates) {
      if (!coordinates || coordinates.length < 2) return;
      const lngs = coordinates.map((coord) => coord[0]);
      const lats = coordinates.map((coord) => coord[1]);
      fitBounds(
        Math.min.apply(null, lngs),
        Math.min.apply(null, lats),
        Math.max.apply(null, lngs),
        Math.max.apply(null, lats)
      );
    }

    function setRoute(incoming) {
      currentRoute = incoming;
      if (!map) {
        pendingRoute = incoming;
        return;
      }

      const coordinates = normalizeRouteCoordinates(incoming);
      clearRoute();

      if (coordinates.length < 2) {
        currentRoute = null;
        sendToHost({ type: 'route-cleared' });
        return;
      }

      try {
        const feature = {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coordinates },
          properties: {},
        };

        if (map.getSource && map.getSource('route-source')) {
          map.getSource('route-source').setData(feature);
        } else {
          map.addSource('route-source', { type: 'geojson', data: feature });
          map.addLayer({
            id: 'route-line',
            type: 'line',
            source: 'route-source',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': '#22d3ee',
              'line-width': 4,
              'line-opacity': 0.92,
            },
          });
        }

        fitToRoute(coordinates);
        sendToHost({ type: 'route-ready', payload: { engine: engine, points: coordinates.length } });
      } catch {
        sendToHost({ type: 'warning', payload: 'Failed to draw route.' });
      }
    }

    function updateHeatmapVisibility() {
      if (!map) return;
      const visibility = heatmapVisible ? 'visible' : 'none';

      try {
        if (map.getLayer && map.getLayer('heatmap-layer')) {
          map.setLayoutProperty('heatmap-layer', 'visibility', visibility);
        }
        if (map.getLayer && map.getLayer('heatmap-points-layer')) {
          map.setLayoutProperty('heatmap-points-layer', 'visibility', visibility);
        }
      } catch {
        // visibility updates are non-critical
      }
    }

    function setHeatmap(incoming) {
      currentHeatmap = normalizeHeatmap(incoming);
      if (!map) {
        pendingHeatmap = currentHeatmap;
        return;
      }

      removeLayerAndSource('heatmap-layer', 'heatmap-source');
      removeLayerAndSource('heatmap-points-layer', 'heatmap-source');

      if (!currentHeatmap.length) {
        return;
      }

      const data = {
        type: 'FeatureCollection',
        features: currentHeatmap.map((point, idx) => ({
          type: 'Feature',
          id: idx,
          properties: {
            weight: point.weight,
          },
          geometry: {
            type: 'Point',
            coordinates: [point.longitude, point.latitude],
          },
        })),
      };

      try {
        map.addSource('heatmap-source', {
          type: 'geojson',
          data: data,
        });

        map.addLayer({
          id: 'heatmap-layer',
          type: 'heatmap',
          source: 'heatmap-source',
          maxzoom: 16,
          paint: {
            'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 0, 0, 3, 1],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 12, 1.4],
            'heatmap-color': [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0,
              'rgba(37,99,235,0)',
              0.2,
              '#2563eb',
              0.45,
              '#22c55e',
              0.65,
              '#facc15',
              0.85,
              '#f97316',
              1,
              '#dc2626',
            ],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 5, 16, 12, 30],
            'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.95, 16, 0.6],
          },
        });

        map.addLayer({
          id: 'heatmap-points-layer',
          type: 'circle',
          source: 'heatmap-source',
          minzoom: 12,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'weight'], 0.1, 3, 3, 8],
            'circle-color': '#f97316',
            'circle-opacity': 0.45,
            'circle-stroke-color': '#f8fafc',
            'circle-stroke-width': 1,
          },
        });

        updateHeatmapVisibility();
      } catch {
        sendToHost({ type: 'warning', payload: 'Failed to render heatmap layer.' });
      }
    }

    function setHeatmapVisibility(visible) {
      heatmapVisible = Boolean(visible);
      if (!map) {
        pendingHeatmapVisible = heatmapVisible;
        return;
      }
      updateHeatmapVisibility();
    }

    function setIsochrones(incoming) {
      currentIsochrones = normalizeIsochronesFeatureCollection(incoming);
      if (!map) {
        pendingIsochrones = currentIsochrones;
        return;
      }

      removeLayerAndSource('isochrone-fill-layer', 'isochrone-source');
      removeLayerAndSource('isochrone-line-layer', 'isochrone-source');

      if (!currentIsochrones.features.length) {
        return;
      }

      try {
        map.addSource('isochrone-source', {
          type: 'geojson',
          data: currentIsochrones,
        });

        map.addLayer({
          id: 'isochrone-fill-layer',
          type: 'fill',
          source: 'isochrone-source',
          paint: {
            'fill-color': [
              'interpolate',
              ['linear'],
              ['coalesce', ['to-number', ['get', 'contour']], 10],
              5,
              '#22c55e',
              10,
              '#facc15',
              15,
              '#f97316',
              20,
              '#ef4444',
            ],
            'fill-opacity': 0.24,
          },
        });

        map.addLayer({
          id: 'isochrone-line-layer',
          type: 'line',
          source: 'isochrone-source',
          paint: {
            'line-width': 2,
            'line-color': '#f8fafc',
            'line-opacity': 0.85,
          },
        });

        sendToHost({
          type: 'isochrone-ready',
          payload: { count: currentIsochrones.features.length },
        });
      } catch {
        sendToHost({ type: 'warning', payload: 'Failed to render isochrones.' });
      }
    }

    function clearIsochrones() {
      currentIsochrones = { type: 'FeatureCollection', features: [] };
      removeLayerAndSource('isochrone-fill-layer', 'isochrone-source');
      removeLayerAndSource('isochrone-line-layer', 'isochrone-source');
      sendToHost({ type: 'isochrone-cleared' });
    }

    function add3DBuildings() {
      if (!map) return;
      if (map.getLayer && map.getLayer('custom-3d-buildings')) return;

      const style = map.getStyle && map.getStyle();
      const layers = style && Array.isArray(style.layers) ? style.layers : [];
      const labelLayer = layers.find(
        (layer) => layer.type === 'symbol' && layer.layout && layer.layout['text-field']
      );

      try {
        if (engine === 'mapbox') {
          map.addLayer(
            {
              id: 'custom-3d-buildings',
              type: 'fill-extrusion',
              source: 'composite',
              'source-layer': 'building',
              filter: ['==', ['get', 'extrude'], 'true'],
              minzoom: 14,
              paint: {
                'fill-extrusion-color': '#64748b',
                'fill-extrusion-height': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  14,
                  0,
                  16,
                  ['coalesce', ['get', 'height'], 24],
                ],
                'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
                'fill-extrusion-opacity': 0.58,
              },
            },
            labelLayer ? labelLayer.id : undefined
          );
          return;
        }

        if (engine === 'maplibre') {
          map.addLayer(
            {
              id: 'custom-3d-buildings',
              type: 'fill-extrusion',
              source: 'openmaptiles',
              'source-layer': 'building',
              minzoom: 14,
              paint: {
                'fill-extrusion-color': '#64748b',
                'fill-extrusion-opacity': 0.55,
                'fill-extrusion-height': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  14,
                  0,
                  16,
                  ['coalesce', ['get', 'render_height'], ['get', 'height'], 24],
                ],
                'fill-extrusion-base': [
                  'coalesce',
                  ['get', 'render_min_height'],
                  ['get', 'min_height'],
                  0,
                ],
              },
            },
            labelLayer ? labelLayer.id : undefined
          );
        }
      } catch {
        // non-critical decoration
      }
    }

    function setTerrainEnabled(enabled) {
      terrainEnabled = Boolean(enabled);
      if (!map) {
        pendingTerrain = terrainEnabled;
        return;
      }
      if (engine !== 'mapbox') return;

      try {
        if (terrainEnabled) {
          if (!(map.getSource && map.getSource('mapbox-dem'))) {
            map.addSource('mapbox-dem', {
              type: 'raster-dem',
              url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
              tileSize: 512,
              maxzoom: 14,
            });
          }

          if (typeof map.setTerrain === 'function') {
            map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.25 });
          }

          if (!(map.getLayer && map.getLayer('sky')) && typeof map.addLayer === 'function') {
            map.addLayer({
              id: 'sky',
              type: 'sky',
              paint: {
                'sky-type': 'atmosphere',
                'sky-atmosphere-sun': [0.0, 0.0],
                'sky-atmosphere-sun-intensity': 12,
              },
            });
          }

          if (!terrainAnnounced) {
            terrainAnnounced = true;
            sendToHost({ type: 'terrain-ready', payload: 'mapbox-terrain-dem-v1' });
          }
        } else if (typeof map.setTerrain === 'function') {
          map.setTerrain(null);
        }
      } catch {
        sendToHost({ type: 'warning', payload: 'Failed to update terrain mode.' });
      }
    }

    function enableMapboxTraffic() {
      if (!map || engine !== 'mapbox') return;

      try {
        const hasLayer = map.getLayer && map.getLayer('mapbox-traffic-line');
        if (!hasLayer) {
          if (!(map.getSource && map.getSource('mapbox-traffic'))) {
            map.addSource('mapbox-traffic', {
              type: 'vector',
              url: 'mapbox://mapbox.mapbox-traffic-v1',
            });
          }

          const style = map.getStyle && map.getStyle();
          const layers = style && Array.isArray(style.layers) ? style.layers : [];
          const labelLayer = layers.find(
            (layer) => layer.type === 'symbol' && layer.layout && layer.layout['text-field']
          );

          map.addLayer(
            {
              id: 'mapbox-traffic-line',
              type: 'line',
              source: 'mapbox-traffic',
              'source-layer': 'traffic',
              layout: {
                'line-join': 'round',
                'line-cap': 'round',
              },
              paint: {
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.2, 14, 3.8],
                'line-opacity': 0.88,
                'line-color': [
                  'match',
                  ['get', 'congestion'],
                  'low',
                  '#22c55e',
                  'moderate',
                  '#facc15',
                  'heavy',
                  '#f97316',
                  'severe',
                  '#ef4444',
                  '#60a5fa',
                ],
              },
            },
            labelLayer ? labelLayer.id : undefined
          );
        }

        if (!trafficAnnounced) {
          trafficAnnounced = true;
          sendToHost({ type: 'traffic-ready', payload: 'mapbox-traffic-v1' });
        }
      } catch {
        sendToHost({ type: 'warning', payload: 'Failed to enable Mapbox traffic layer.' });
      }
    }

    function buildDrawMetrics(feature) {
      const geometry = feature && feature.geometry;
      if (!geometry) return null;

      let areaM2 = 0;
      if (window.turf && typeof window.turf.area === 'function') {
        try {
          areaM2 = Number(window.turf.area(feature)) || 0;
        } catch {
          areaM2 = 0;
        }
      }

      let centroid = null;
      if (window.turf && typeof window.turf.centroid === 'function') {
        try {
          const centroidFeature = window.turf.centroid(feature);
          const coords = centroidFeature && centroidFeature.geometry && centroidFeature.geometry.coordinates;
          if (Array.isArray(coords) && coords.length >= 2) {
            centroid = {
              longitude: Number(coords[0]),
              latitude: Number(coords[1]),
            };
          }
        } catch {
          centroid = null;
        }
      }

      const ring =
        geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)
          ? geometry.coordinates[0]
          : [];

      return {
        area_m2: areaM2,
        area_km2: areaM2 / 1000000,
        centroid: centroid,
        vertices: Array.isArray(ring) ? Math.max(0, ring.length - 1) : 0,
      };
    }

    function onDrawChanged() {
      if (!drawControl || typeof drawControl.getAll !== 'function') return;

      try {
        const all = drawControl.getAll();
        const features = Array.isArray(all && all.features) ? all.features : [];

        if (!features.length) {
          sendToHost({ type: 'draw-cleared' });
          return;
        }

        const feature = features[features.length - 1];
        const metrics = buildDrawMetrics(feature);

        sendToHost({
          type: 'draw-complete',
          payload: {
            geojson: feature,
            ...(metrics || {}),
          },
        });
      } catch {
        sendToHost({ type: 'warning', payload: 'Failed to process drawn polygon.' });
      }
    }

    function setDrawMode(enabled) {
      drawEnabled = Boolean(enabled);
      if (!map || engine !== 'mapbox') {
        pendingDrawMode = drawEnabled;
        return;
      }

      if (!window.MapboxDraw) {
        sendToHost({ type: 'warning', payload: 'Draw toolkit failed to load.' });
        return;
      }

      try {
        if (drawEnabled) {
          if (!drawControl) {
            drawControl = new window.MapboxDraw({
              displayControlsDefault: false,
              controls: {
                polygon: true,
                trash: true,
              },
              defaultMode: 'simple_select',
            });
          }

          if (!drawControlAttached) {
            map.addControl(drawControl, 'top-left');
            drawControlAttached = true;
          }

          if (typeof drawControl.changeMode === 'function') {
            drawControl.changeMode('draw_polygon');
          }
          return;
        }

        if (drawControl && drawControlAttached) {
          map.removeControl(drawControl);
          drawControlAttached = false;
        }
      } catch {
        sendToHost({ type: 'warning', payload: 'Failed to update draw mode.' });
      }
    }

    function reapplyMapDecorations() {
      if (!map) return;

      if (engine === 'mapbox') {
        enableMapboxTraffic();
        setTerrainEnabled(terrainEnabled);
      }

      add3DBuildings();
      setHeatmap(currentHeatmap);
      updateHeatmapVisibility();
      setIsochrones(currentIsochrones);

      if (currentPoints && currentPoints.length) {
        setPoints(currentPoints);
      }

      if (currentRoute) {
        setRoute(currentRoute);
      }

      if (engine === 'mapbox') {
        setDrawMode(drawEnabled);
      }
    }

    function applyTheme(incoming) {
      const theme = normalizeTheme(incoming);
      currentTheme = theme;

      if (!map) {
        pendingTheme = theme;
        return;
      }

      const styleUrl = engine === 'mapbox' ? getMapboxStyle(theme) : getMapLibreStyle(theme);
      if (!styleUrl || typeof map.setStyle !== 'function') return;

      try {
        if (typeof map.once === 'function') {
          map.once('style.load', () => {
            reapplyMapDecorations();
          });
        }

        map.setStyle(styleUrl);
      } catch {
        sendToHost({ type: 'warning', payload: 'Failed to switch map style.' });
        return;
      }

      let attempts = 0;
      const waitAndReapply = () => {
        attempts += 1;
        if (!map) return;

        const ready = typeof map.isStyleLoaded === 'function' ? map.isStyleLoaded() : true;
        if (!ready && attempts < 40) {
          setTimeout(waitAndReapply, 120);
          return;
        }

        reapplyMapDecorations();
      };

      setTimeout(waitAndReapply, 0);
    }

    function ensureStylesheet(id, href) {
      if (document.getElementById(id)) return;
      const css = document.createElement('link');
      css.id = id;
      css.rel = 'stylesheet';
      css.href = href;
      document.head.appendChild(css);
    }

    function loadScript(id, src) {
      return new Promise((resolve, reject) => {
        const existing = document.getElementById(id);
        if (existing) {
          resolve();
          return;
        }

        const script = document.createElement('script');
        script.id = id;
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load script: ' + src));
        document.head.appendChild(script);
      });
    }

    function attachSharedMessageListener() {
      window.addEventListener('message', (event) => {
        let message = event.data;
        if (typeof message === 'string') {
          try {
            message = JSON.parse(message);
          } catch {
            return;
          }
        }

        if (message && message.type === 'set-points') {
          setPoints(Array.isArray(message.payload) ? message.payload : []);
        }

        if (message && message.type === 'set-route') {
          setRoute(message.payload);
        }

        if (message && message.type === 'clear-route') {
          clearRoute();
          currentRoute = null;
          pendingRoute = null;
          sendToHost({ type: 'route-cleared' });
        }

        if (message && message.type === 'set-theme') {
          applyTheme(message.payload);
        }

        if (message && message.type === 'set-heatmap') {
          setHeatmap(message.payload);
        }

        if (message && message.type === 'set-heatmap-visibility') {
          setHeatmapVisibility(message.payload);
        }

        if (message && message.type === 'set-terrain') {
          setTerrainEnabled(message.payload);
        }

        if (message && message.type === 'set-draw-mode') {
          setDrawMode(message.payload);
        }

        if (message && message.type === 'set-isochrones') {
          setIsochrones(message.payload);
        }

        if (message && message.type === 'clear-isochrones') {
          clearIsochrones();
        }
      });
    }

    function initMapLibre() {
      function startMapLibre() {
        if (map) return;

        engine = 'maplibre';
        map = new window.maplibregl.Map({
          container: 'map',
          style: getMapLibreStyle(pendingTheme || currentTheme),
          center: [82.61, 49.95],
          zoom: 13,
          pitch: 60,
          bearing: -17,
          antialias: true,
        });

        if (window.maplibregl.NavigationControl) {
          map.addControl(new window.maplibregl.NavigationControl(), 'top-right');
        }

        map.on('load', () => {
          add3DBuildings();
          setPoints(pendingPoints || POINTS);
          pendingPoints = null;

          if (pendingRoute) {
            setRoute(pendingRoute);
            pendingRoute = null;
          }

          if (pendingHeatmap) {
            setHeatmap(pendingHeatmap);
            pendingHeatmap = null;
          }

          if (pendingHeatmapVisible !== null) {
            setHeatmapVisibility(pendingHeatmapVisible);
            pendingHeatmapVisible = null;
          }

          if (pendingIsochrones) {
            setIsochrones(pendingIsochrones);
            pendingIsochrones = null;
          }

          if (pendingTheme) {
            currentTheme = pendingTheme;
            pendingTheme = null;
          }

          sendToHost({ type: 'ready', payload: 'maplibre' });
        });

        map.on('click', (event) => {
          if (!event || !event.lngLat) return;
          if (drawEnabled) return;

          sendToHost({
            type: 'map-click',
            payload: {
              latitude: Number(event.lngLat.lat),
              longitude: Number(event.lngLat.lng),
            },
          });
        });
      }

      if (window.maplibregl) {
        startMapLibre();
        return;
      }

      ensureStylesheet('maplibre-style', 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css');

      loadScript('maplibre-script', 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js')
        .then(startMapLibre)
        .catch(() => {
          sendToHost({
            type: 'error',
            payload: 'Fallback map failed to load. Check internet connection.',
          });
        });
    }

    function initMapbox() {
      if (!API_TOKEN) {
        sendToHost({
          type: 'warning',
          payload: 'Mapbox token is not set. Fallback map enabled.',
        });
        initMapLibre();
        return;
      }

      function startMapbox() {
        if (map) return;

        if (!window.mapboxgl || !window.mapboxgl.Map) {
          sendToHost({
            type: 'warning',
            payload: 'Mapbox SDK init failed. Switched to fallback map.',
          });
          initMapLibre();
          return;
        }

        try {
          window.mapboxgl.accessToken = API_TOKEN;
          engine = 'mapbox';
          map = new window.mapboxgl.Map({
            container: 'map',
            style: getMapboxStyle(pendingTheme || currentTheme),
            center: [82.61, 49.95],
            zoom: 13,
            pitch: 60,
            bearing: -17,
            antialias: true,
          });

          if (window.mapboxgl.NavigationControl) {
            map.addControl(new window.mapboxgl.NavigationControl(), 'top-right');
          }

          map.on('load', () => {
            enableMapboxTraffic();
            add3DBuildings();
            setTerrainEnabled(pendingTerrain !== null ? pendingTerrain : terrainEnabled);

            setPoints(pendingPoints || POINTS);
            pendingPoints = null;

            if (pendingRoute) {
              setRoute(pendingRoute);
              pendingRoute = null;
            }

            if (pendingHeatmap) {
              setHeatmap(pendingHeatmap);
              pendingHeatmap = null;
            }

            if (pendingHeatmapVisible !== null) {
              setHeatmapVisibility(pendingHeatmapVisible);
              pendingHeatmapVisible = null;
            }

            if (pendingIsochrones) {
              setIsochrones(pendingIsochrones);
              pendingIsochrones = null;
            }

            if (pendingDrawMode !== null) {
              setDrawMode(pendingDrawMode);
              pendingDrawMode = null;
            }

            if (pendingTheme) {
              applyTheme(pendingTheme);
              pendingTheme = null;
            }

            sendToHost({ type: 'ready', payload: 'mapbox' });
          });

          map.on('draw.create', onDrawChanged);
          map.on('draw.update', onDrawChanged);
          map.on('draw.delete', onDrawChanged);

          map.on('click', (event) => {
            if (!event || !event.lngLat) return;
            if (drawEnabled) return;

            sendToHost({
              type: 'map-click',
              payload: {
                latitude: Number(event.lngLat.lat),
                longitude: Number(event.lngLat.lng),
              },
            });
          });
        } catch {
          sendToHost({
            type: 'warning',
            payload: 'Mapbox token is invalid. Switched to fallback map.',
          });
          map = null;
          initMapLibre();
        }
      }

      function startWithMapboxAssets() {
        ensureStylesheet('mapbox-style', 'https://api.mapbox.com/mapbox-gl-js/v3.17.0/mapbox-gl.css');
        ensureStylesheet(
          'mapbox-draw-style',
          'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-draw/v1.5.0/mapbox-gl-draw.css'
        );

        const ensureMapbox = window.mapboxgl
          ? Promise.resolve()
          : loadScript('mapbox-script', 'https://api.mapbox.com/mapbox-gl-js/v3.17.0/mapbox-gl.js');

        ensureMapbox
          .then(() =>
            Promise.allSettled([
              window.MapboxDraw
                ? Promise.resolve()
                : loadScript(
                    'mapbox-draw-script',
                    'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-draw/v1.5.0/mapbox-gl-draw.js'
                  ),
              window.turf
                ? Promise.resolve()
                : loadScript('turf-script', 'https://unpkg.com/@turf/turf@6/turf.min.js'),
            ])
          )
          .then((results) => {
            const failed = results.filter((item) => item.status === 'rejected').length;
            if (failed) {
              sendToHost({
                type: 'warning',
                payload: 'Optional draw/analytics assets are unavailable.',
              });
            }
            startMapbox();
          })
          .catch(() => {
            sendToHost({
              type: 'warning',
              payload: 'Mapbox assets load failed. Switched to fallback map.',
            });
            initMapLibre();
          });
      }

      startWithMapboxAssets();
    }

    window.__setPoints = (incoming) => {
      setPoints(Array.isArray(incoming) ? incoming : []);
    };

    window.__setRoute = (incoming) => {
      setRoute(incoming);
    };

    window.__setTheme = (incoming) => {
      applyTheme(incoming);
    };

    window.__clearRoute = () => {
      clearRoute();
      currentRoute = null;
      pendingRoute = null;
      sendToHost({ type: 'route-cleared' });
    };

    window.__setHeatmap = (incoming) => {
      setHeatmap(incoming);
    };

    window.__setHeatmapVisibility = (incoming) => {
      setHeatmapVisibility(incoming);
    };

    window.__setTerrain = (incoming) => {
      setTerrainEnabled(incoming);
    };

    window.__setDrawMode = (incoming) => {
      setDrawMode(incoming);
    };

    window.__setIsochrones = (incoming) => {
      setIsochrones(incoming);
    };

    window.__clearIsochrones = () => {
      clearIsochrones();
    };

    attachSharedMessageListener();
    initMapbox();
  </script>
</body>
</html>`;
}

export default function Map3D({
  points = [],
  route = [],
  theme = 'dark',
  apiKey,
  onMapPress,
  style,
  mapboxStyleLight,
  mapboxStyleDark,
  heatmapPoints = [],
  showHeatmap = true,
  terrainEnabled = true,
  drawEnabled = false,
  isochrones = null,
  onPolygonDrawn,
  onDrawCleared,
}) {
  const { t } = useI18n();
  const iframeRef = useRef(null);
  const webViewRef = useRef(null);
  const initialThemeRef = useRef(theme === 'light' ? 'light' : 'dark');
  const [iframeReady, setIframeReady] = useState(false);
  const [statusText, setStatusText] = useState('');

  const html = useMemo(
    () =>
      buildHtml({
        apiKey,
        initialTheme: initialThemeRef.current,
        styleLight: mapboxStyleLight,
        styleDark: mapboxStyleDark,
      }),
    [apiKey, mapboxStyleLight, mapboxStyleDark]
  );

  const handleBridgeMessage = useCallback(
    (data) => {
      if (!data) return;

      if (data.type === 'map-click' && data.payload) {
        onMapPress?.(data.payload);
        return;
      }

      if (data.type === 'draw-complete' && data.payload) {
        onPolygonDrawn?.(data.payload);
        return;
      }

      if (data.type === 'draw-cleared') {
        onDrawCleared?.();
        return;
      }

      if (data.type === 'warning' || data.type === 'error') {
        setStatusText(String(data.payload || 'Map warning'));
        return;
      }

      if (data.type === 'traffic-ready') {
        setStatusText(t('map3d.traffic_ready'));
        return;
      }

      if (data.type === 'terrain-ready') {
        setStatusText(t('map3d.terrain_ready'));
        return;
      }

      if (data.type === 'isochrone-ready') {
        setStatusText(t('map3d.isochrone_ready'));
        return;
      }

      if (data.type === 'traffic-score') {
        const score = Number(data.payload);
        if (Number.isFinite(score)) {
          setStatusText(t('map3d.traffic_score', { score }));
        }
        return;
      }

      if (data.type === 'ready') {
        if (data.payload === 'mapbox') {
          setStatusText(t('map3d.mapbox_ready'));
          return;
        }

        if (data.payload === 'maplibre') {
          setStatusText(t('map3d.fallback_ready'));
        }
      }
    },
    [onMapPress, onPolygonDrawn, onDrawCleared, t]
  );

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;

    const onMessage = (event) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      const data = parsePayload(event.data);
      handleBridgeMessage(data);
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [handleBridgeMessage]);

  useEffect(() => {
    const normalized = normalizePoints(points);

    if (Platform.OS === 'web') {
      if (!iframeRef.current || !iframeReady) return;
      iframeRef.current.contentWindow?.postMessage({ type: 'set-points', payload: normalized }, '*');
      return;
    }

    if (!webViewRef.current) return;

    webViewRef.current.injectJavaScript(`
      window.__setPoints && window.__setPoints(${JSON.stringify(normalized)});
      true;
    `);
  }, [points, iframeReady]);

  useEffect(() => {
    const normalized = normalizeRoute(route);

    if (Platform.OS === 'web') {
      if (!iframeRef.current || !iframeReady) return;
      iframeRef.current.contentWindow?.postMessage(
        normalized.length ? { type: 'set-route', payload: normalized } : { type: 'clear-route' },
        '*'
      );
      return;
    }

    if (!webViewRef.current) return;

    const js = normalized.length
      ? `window.__setRoute && window.__setRoute(${JSON.stringify(normalized)}); true;`
      : `window.__clearRoute && window.__clearRoute(); true;`;

    webViewRef.current.injectJavaScript(js);
  }, [route, iframeReady]);

  useEffect(() => {
    const normalizedTheme = theme === 'light' ? 'light' : 'dark';

    if (Platform.OS === 'web') {
      if (!iframeRef.current || !iframeReady) return;
      iframeRef.current.contentWindow?.postMessage(
        { type: 'set-theme', payload: normalizedTheme },
        '*'
      );
      return;
    }

    if (!webViewRef.current) return;

    webViewRef.current.injectJavaScript(`
      window.__setTheme && window.__setTheme(${JSON.stringify(normalizedTheme)});
      true;
    `);
  }, [theme, iframeReady]);

  useEffect(() => {
    const normalized = normalizeHeatmapPoints(heatmapPoints);

    if (Platform.OS === 'web') {
      if (!iframeRef.current || !iframeReady) return;
      iframeRef.current.contentWindow?.postMessage(
        { type: 'set-heatmap', payload: normalized },
        '*'
      );
      return;
    }

    if (!webViewRef.current) return;
    webViewRef.current.injectJavaScript(`
      window.__setHeatmap && window.__setHeatmap(${JSON.stringify(normalized)});
      true;
    `);
  }, [heatmapPoints, iframeReady]);

  useEffect(() => {
    const visible = Boolean(showHeatmap);

    if (Platform.OS === 'web') {
      if (!iframeRef.current || !iframeReady) return;
      iframeRef.current.contentWindow?.postMessage(
        { type: 'set-heatmap-visibility', payload: visible },
        '*'
      );
      return;
    }

    if (!webViewRef.current) return;
    webViewRef.current.injectJavaScript(`
      window.__setHeatmapVisibility && window.__setHeatmapVisibility(${JSON.stringify(visible)});
      true;
    `);
  }, [showHeatmap, iframeReady]);

  useEffect(() => {
    const enabled = Boolean(terrainEnabled);

    if (Platform.OS === 'web') {
      if (!iframeRef.current || !iframeReady) return;
      iframeRef.current.contentWindow?.postMessage(
        { type: 'set-terrain', payload: enabled },
        '*'
      );
      return;
    }

    if (!webViewRef.current) return;
    webViewRef.current.injectJavaScript(`
      window.__setTerrain && window.__setTerrain(${JSON.stringify(enabled)});
      true;
    `);
  }, [terrainEnabled, iframeReady]);

  useEffect(() => {
    const enabled = Boolean(drawEnabled);

    if (Platform.OS === 'web') {
      if (!iframeRef.current || !iframeReady) return;
      iframeRef.current.contentWindow?.postMessage(
        { type: 'set-draw-mode', payload: enabled },
        '*'
      );
      return;
    }

    if (!webViewRef.current) return;
    webViewRef.current.injectJavaScript(`
      window.__setDrawMode && window.__setDrawMode(${JSON.stringify(enabled)});
      true;
    `);
  }, [drawEnabled, iframeReady]);

  useEffect(() => {
    const normalized = normalizeIsochrones(isochrones);

    if (Platform.OS === 'web') {
      if (!iframeRef.current || !iframeReady) return;
      iframeRef.current.contentWindow?.postMessage(
        normalized.features.length
          ? { type: 'set-isochrones', payload: normalized }
          : { type: 'clear-isochrones' },
        '*'
      );
      return;
    }

    if (!webViewRef.current) return;

    const js = normalized.features.length
      ? `window.__setIsochrones && window.__setIsochrones(${JSON.stringify(normalized)}); true;`
      : `window.__clearIsochrones && window.__clearIsochrones(); true;`;

    webViewRef.current.injectJavaScript(js);
  }, [isochrones, iframeReady]);

  return (
    <View style={[styles.container, style]}>
      {Platform.OS === 'web' ? (
        <iframe
          ref={iframeRef}
          title="map-3d"
          srcDoc={html}
          onLoad={() => setIframeReady(true)}
          style={styles.frame}
        />
      ) : (
        <WebView
          ref={webViewRef}
          originWhitelist={['*']}
          source={{ html }}
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          onMessage={(event) => {
            const data = parsePayload(event.nativeEvent?.data);
            handleBridgeMessage(data);
          }}
          style={styles.frame}
        />
      )}

      {statusText ? (
        <View style={styles.statusBanner}>
          <Text style={styles.statusText}>{statusText}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: '100%',
    minHeight: 360,
    position: 'relative',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#0b1020',
  },
  frame: {
    width: '100%',
    height: '100%',
    minHeight: 360,
    borderWidth: 0,
    backgroundColor: '#0b1020',
  },
  statusBanner: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#6d28d9',
    backgroundColor: 'rgba(17, 24, 39, 0.9)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusText: {
    color: '#ddd6fe',
    fontSize: 12,
    fontWeight: '600',
  },
});
