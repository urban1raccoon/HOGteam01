import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

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

function buildHtml({ points, apiKey }) {
  const safePoints = normalizePoints(points);
  const safeKey = (apiKey || '').trim();

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
    .dg-label {
      color: #f8fafc;
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(148, 163, 184, 0.35);
      border-radius: 8px;
      padding: 6px 8px;
      font: 12px/1.2 -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif;
      box-shadow: 0 8px 24px rgba(2, 6, 23, 0.35);
      white-space: nowrap;
    }
    .dg-dot {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 2px solid #00121f;
      box-shadow: 0 0 0 3px rgba(45, 212, 191, 0.2);
    }
  </style>
</head>
<body>
  <div id="map"></div>

  <script>
    const POINTS = ${JSON.stringify(safePoints)};
    const API_KEY = ${JSON.stringify(safeKey)};

    let engine = null;
    let map = null;
    let markers = [];
    let trafficControl = null;
    let trafficLayer = null;

    function sendToHost(payload) {
      const msg = JSON.stringify(payload);
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(msg);
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(msg, '*');
      }
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

    function clearMarkers() {
      markers.forEach((marker) => {
        if (!marker) return;
        if (engine === '2gis' && typeof marker.destroy === 'function') marker.destroy();
        if (engine === 'maplibre' && typeof marker.remove === 'function') marker.remove();
      });
      markers = [];
    }

    function fitToPoints(points) {
      if (!map || !points.length) return;

      const lngs = points.map((p) => p.longitude);
      const lats = points.map((p) => p.latitude);
      const minLng = Math.min.apply(null, lngs);
      const maxLng = Math.max.apply(null, lngs);
      const minLat = Math.min.apply(null, lats);
      const maxLat = Math.max.apply(null, lats);

      if (!(Number.isFinite(minLng) && Number.isFinite(maxLng) && Number.isFinite(minLat) && Number.isFinite(maxLat))) {
        return;
      }

      if (engine === '2gis' && typeof map.fitBounds === 'function') {
        map.fitBounds([minLng, minLat], [maxLng, maxLat], {
          padding: 50,
          maxZoom: 15,
          duration: 400,
        });
      }

      if (engine === 'maplibre' && typeof map.fitBounds === 'function') {
        map.fitBounds(
          [minLng, minLat],
          [maxLng, maxLat],
          {
            padding: 50,
            maxZoom: 15,
            duration: 400,
          }
        );
      }
    }

    function setPoints(points) {
      if (!map) return;

      clearMarkers();

      points.forEach((p) => {
        if (engine === '2gis' && window.mapgl) {
          const marker = new window.mapgl.HtmlMarker(map, {
            coordinates: [p.longitude, p.latitude],
            html: '<div class="dg-dot" style="background:' + makeDotColor(p.category) + '"></div>',
          });

          if (p.name) {
            const label = new window.mapgl.HtmlMarker(map, {
              coordinates: [p.longitude, p.latitude],
              html: '<div class="dg-label">' + p.name.replace(/</g, '&lt;') + '</div>',
              anchor: [0, -26],
            });
            markers.push(label);
          }

          markers.push(marker);
          return;
        }

        if (engine === 'maplibre' && window.maplibregl) {
          const marker = new window.maplibregl.Marker({ color: makeDotColor(p.category) })
            .setLngLat([p.longitude, p.latitude]);

          if (p.name) {
            marker.setPopup(new window.maplibregl.Popup({ offset: 12 }).setText(p.name));
          }

          marker.addTo(map);
          markers.push(marker);
        }
      });

      fitToPoints(points);
    }

    function enable2GISTraffic() {
      if (!map || engine !== '2gis' || !window.mapgl) return;

      try {
        if (window.mapgl.TrafficControl) {
          trafficControl = new window.mapgl.TrafficControl(map, { position: 'topLeft' });
          if (trafficControl && typeof trafficControl.show === 'function') {
            trafficControl.show();
          } else if (trafficControl && typeof trafficControl.toggle === 'function') {
            trafficControl.toggle();
          }
          sendToHost({ type: 'traffic-ready', payload: '2gis-live' });
          return;
        }

        if (window.mapgl.Traffic) {
          trafficLayer = new window.mapgl.Traffic(map, { isVisible: true });
          if (trafficLayer && typeof trafficLayer.show === 'function') {
            trafficLayer.show();
          }
          sendToHost({ type: 'traffic-ready', payload: '2gis-live' });
          return;
        }

        sendToHost({
          type: 'warning',
          payload: '2GIS traffic layer is unavailable in this SDK build.',
        });
      } catch {
        sendToHost({
          type: 'warning',
          payload: 'Failed to enable 2GIS traffic layer.',
        });
      }
    }

    function add3DBuildings() {
      if (!map || engine !== 'maplibre') return;
      if (map.getLayer && map.getLayer('custom-3d-buildings')) return;

      const style = map.getStyle && map.getStyle();
      const layers = style && Array.isArray(style.layers) ? style.layers : [];
      const labelLayer = layers.find(
        (layer) => layer.type === 'symbol' && layer.layout && layer.layout['text-field']
      );

      try {
        map.addLayer(
          {
            id: 'custom-3d-buildings',
            type: 'fill-extrusion',
            source: 'openmaptiles',
            'source-layer': 'building',
            minzoom: 14,
            paint: {
              'fill-extrusion-color': '#7c3aed',
              'fill-extrusion-opacity': 0.62,
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
      } catch {
        // Some fallback styles do not include an OpenMapTiles building source.
      }
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
      });
    }

    function initMapLibre() {
      function startMapLibre() {
        if (map) return;

        engine = 'maplibre';
        map = new window.maplibregl.Map({
          container: 'map',
          style: 'https://demotiles.maplibre.org/style.json',
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
          setPoints(POINTS);
          sendToHost({ type: 'ready', payload: 'maplibre' });
        });

        map.on('click', (e) => {
          if (!e || !e.lngLat) return;
          sendToHost({
            type: 'map-click',
            payload: {
              latitude: Number(e.lngLat.lat),
              longitude: Number(e.lngLat.lng),
            },
          });
        });
      }

      if (window.maplibregl) {
        startMapLibre();
        return;
      }

      if (!document.getElementById('maplibre-style')) {
        const css = document.createElement('link');
        css.id = 'maplibre-style';
        css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
        document.head.appendChild(css);
      }

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
      script.async = true;
      script.onload = startMapLibre;
      script.onerror = function () {
        sendToHost({
          type: 'error',
          payload: 'Map fallback failed to load. Check internet connection.',
        });
      };
      document.head.appendChild(script);
    }

    function init2GIS() {
      if (!API_KEY) {
        sendToHost({
          type: 'warning',
          payload: '2GIS key is not set. Fallback map enabled.',
        });
        initMapLibre();
        return;
      }

      const script = document.createElement('script');
      script.src =
        'https://mapgl.2gis.com/api/js/v1?key=' +
        encodeURIComponent(API_KEY) +
        '&plugins=traffic';
      script.async = true;

      script.onload = function () {
        if (!window.mapgl || !window.mapgl.Map) {
          sendToHost({
            type: 'warning',
            payload: '2GIS SDK init failed. Switched to fallback map.',
          });
          initMapLibre();
          return;
        }

        try {
          engine = '2gis';
          map = new window.mapgl.Map('map', {
            center: [82.61, 49.95],
            zoom: 13,
            key: API_KEY,
            pitch: 60,
            rotation: -17,
          });

          if (typeof map.setPitch === 'function') map.setPitch(60);
          if (typeof map.setRotation === 'function') map.setRotation(-17);

          map.on('click', (e) => {
            if (!e || !e.lngLat) return;
            sendToHost({
              type: 'map-click',
              payload: {
                latitude: Number(e.lngLat.lat),
                longitude: Number(e.lngLat.lng),
              },
            });
          });

          enable2GISTraffic();
          setPoints(POINTS);
          sendToHost({ type: 'ready', payload: '2gis' });
        } catch {
          sendToHost({
            type: 'warning',
            payload: '2GIS key is invalid. Switched to fallback map.',
          });
          map = null;
          initMapLibre();
        }
      };

      script.onerror = function () {
        sendToHost({
          type: 'warning',
          payload: '2GIS SDK load failed. Switched to fallback map.',
        });
        initMapLibre();
      };

      document.head.appendChild(script);
    }

    window.__setPoints = (incoming) => {
      setPoints(Array.isArray(incoming) ? incoming : []);
    };

    attachSharedMessageListener();
    init2GIS();
  </script>
</body>
</html>`;
}

export default function Map3D({ points = [], apiKey, onMapPress, style }) {
  const iframeRef = useRef(null);
  const webViewRef = useRef(null);
  const [iframeReady, setIframeReady] = useState(false);
  const [statusText, setStatusText] = useState('');

  const html = useMemo(() => buildHtml({ points, apiKey }), [points, apiKey]);

  const handleBridgeMessage = useCallback(
    (data) => {
      if (!data) return;

      if (data.type === 'map-click' && data.payload) {
        onMapPress?.(data.payload);
        return;
      }

      if (data.type === 'warning' || data.type === 'error') {
        setStatusText(String(data.payload || 'Map warning'));
        return;
      }

      if (data.type === 'traffic-ready') {
        setStatusText('2GIS traffic layer enabled (green/yellow/red).');
        return;
      }

      if (data.type === 'ready') {
        if (data.payload === 'maplibre') {
          setStatusText('Fallback map active (MapLibre).');
        }
      }
    },
    [onMapPress]
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
      iframeRef.current.contentWindow?.postMessage(
        { type: 'set-points', payload: normalized },
        '*'
      );
      return;
    }

    if (!webViewRef.current) return;

    const js = `
      window.__setPoints && window.__setPoints(${JSON.stringify(normalized)});
      true;
    `;
    webViewRef.current.injectJavaScript(js);
  }, [points, iframeReady]);

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
