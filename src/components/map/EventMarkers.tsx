import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, Popup, Tooltip, useMap, useMapEvent } from 'react-leaflet';
import L from 'leaflet';
import { useUiStore } from '../../store/uiStore';
import { gameToLeaflet } from '../../lib/coordinateTransform';
import { getUsageColor } from '../../types/map';
import { MarkerPopup } from './MarkerPopup';
import type { ResolvedMarker } from '../../lib/lootResolver';
import type { MapConfig } from '../../types/map';

const EVENT_MARKER_RADIUS = 10;
const EVENT_SELECTED_RADIUS = 13;

export function EventMarkers({ markers, mapConfig }: { markers: ResolvedMarker[]; mapConfig: MapConfig }) {
  const map = useMap();
  const selectedEvent    = useUiStore(s => s.selectedEventName);
  const setSelectedEvent = useUiStore(s => s.setSelectedEvent);
  const clusterZoomThreshold = useUiStore(s => s.mapClusterZoomThreshold);
  const hiddenTiers      = useUiStore(s => s.hiddenTiers);
  const hiddenUsages     = useUiStore(s => s.hiddenUsages);
  const hiddenEvents     = useUiStore(s => s.hiddenEvents);
  const mapEventFilter   = useUiStore(s => s.mapEventFilter);

  const [viewportBounds, setViewportBounds] = useState(() => map.getBounds().pad(0.2));
  const canvasRenderer = useMemo(() => L.canvas({ padding: 0.2 }), []);

  useEffect(() => {
    const updateBounds = () => setViewportBounds(map.getBounds().pad(0.2));
    map.on('moveend zoomend', updateBounds);
    return () => {
      map.off('moveend zoomend', updateBounds);
    };
  }, [map]);

  const filterLower = mapEventFilter.toLowerCase();
  const hiddenTierSet = useMemo(() => new Set(hiddenTiers), [hiddenTiers]);
  const hiddenUsageSet = useMemo(() => new Set(hiddenUsages), [hiddenUsages]);
  const hiddenEventSet = useMemo(() => new Set(hiddenEvents), [hiddenEvents]);
  const visible = markers.filter(m => {
    if (hiddenTierSet.has(m.dominantTier)) return false;
    if (hiddenUsageSet.has(m.dominantUsage)) return false;
    if (hiddenEventSet.has(m.eventName)) return false;
    if (filterLower !== '' && !m.eventName.toLowerCase().includes(filterLower)) return false;
    return m.positions.some(pos => viewportBounds.contains(gameToLeaflet(pos.x, pos.z, mapConfig)));
  });

  const visiblePoints = useMemo(() => {
    const points: Array<{ marker: ResolvedMarker; latlng: L.LatLngExpression; key: string }> = [];
    for (const marker of visible) {
      for (let idx = 0; idx < marker.positions.length; idx++) {
        const pos = marker.positions[idx];
        const latlng = gameToLeaflet(pos.x, pos.z, mapConfig);
        if (!viewportBounds.contains(latlng)) continue;
        points.push({
          marker,
          latlng,
          key: `${marker.eventName}-${idx}`,
        });
      }
    }
    return points;
  }, [visible, viewportBounds, mapConfig]);

  const zoom = map.getZoom();
  const showClusters = zoom <= clusterZoomThreshold;

  // Re-render on zoom changes so showClusters updates
  useMapEvent('zoomend', () => {});

  const clusters = useMemo(() => {
    if (!showClusters) return [];

    const gridSize = 56;
    const buckets = new Map<string, {
      count: number;
      xSum: number;
      ySum: number;
      eventNames: Set<string>;
      samplePoint: { marker: ResolvedMarker; latlng: L.LatLngExpression; key: string } | null;
    }>();

    for (const point of visiblePoints) {
      const projected = map.latLngToLayerPoint(point.latlng as L.LatLng);
      const gx = Math.floor(projected.x / gridSize);
      const gy = Math.floor(projected.y / gridSize);
      const key = `${gx}:${gy}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { count: 0, xSum: 0, ySum: 0, eventNames: new Set<string>(), samplePoint: null };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      bucket.xSum += projected.x;
      bucket.ySum += projected.y;
      bucket.eventNames.add(point.marker.eventName);
      bucket.samplePoint = point;
    }

    return [...buckets.values()].map(bucket => {
      const x = bucket.xSum / bucket.count;
      const y = bucket.ySum / bucket.count;
      return {
        center: map.layerPointToLatLng(L.point(x, y)),
        pointCount: bucket.count,
        eventCount: bucket.eventNames.size,
        samplePoint: bucket.samplePoint,
      };
    });
  }, [showClusters, visiblePoints, map]);

  if (showClusters) {
    return (
      <>
        {clusters.map((cluster, idx) => {
          if (cluster.pointCount === 1 && cluster.samplePoint) {
            const { marker, latlng, key } = cluster.samplePoint;
            const usageColor = getUsageColor(marker.dominantUsage);
            const isSelected = selectedEvent === marker.eventName;
            const opacity = marker.inBounds ? (marker.active ? 0.85 : 0.4) : 0.25;

            return (
              <CircleMarker
                key={key}
                center={latlng}
                renderer={canvasRenderer}
                radius={isSelected ? EVENT_SELECTED_RADIUS : EVENT_MARKER_RADIUS}
                pathOptions={{
                  color: '#fff',
                  fillColor: usageColor,
                  fillOpacity: opacity,
                  stroke: isSelected,
                  weight: isSelected ? 3 : 0,
                }}
                eventHandlers={{
                  click: (event) => {
                    setSelectedEvent(selectedEvent === marker.eventName ? null : marker.eventName);
                    event.target.openPopup();
                  },
                }}
              >
                <Popup autoPan={false}><MarkerPopup marker={marker} /></Popup>
              </CircleMarker>
            );
          }

          const radius = Math.min(18, 9 + Math.log2(cluster.pointCount + 1) * 2);
          return (
            <CircleMarker
              key={`cluster-${idx}`}
              center={cluster.center}
              renderer={canvasRenderer}
              radius={radius}
              pathOptions={{
                color: '#f8fafc',
                fillColor: '#334155',
                fillOpacity: 0.8,
                weight: 2,
              }}
              eventHandlers={{
                click: (event) => {
                  event.target.openPopup();
                },
                dblclick: () => {
                  map.setView(cluster.center, Math.min(zoom + 2, 2));
                },
              }}
            >
              <Tooltip permanent direction="center" className="cluster-count-label" interactive={false}>
                {cluster.pointCount}
              </Tooltip>
              <Popup autoPan={false}>
                <div className="text-xs text-slate-200">
                  {cluster.pointCount} points · {cluster.eventCount} events
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </>
    );
  }

  return (
    <>
      {visiblePoints.map(point => {
          const { marker, latlng, key } = point;
          const usageColor = getUsageColor(marker.dominantUsage);
          const isSelected = selectedEvent === marker.eventName;
          const opacity    = marker.inBounds ? (marker.active ? 0.85 : 0.4) : 0.25;
          return (
            <CircleMarker
              key={key}
              center={latlng}
              renderer={canvasRenderer}
              radius={isSelected ? EVENT_SELECTED_RADIUS : EVENT_MARKER_RADIUS}
              pathOptions={{
                color: '#fff',
                fillColor: usageColor,
                fillOpacity: opacity,
                stroke: isSelected,
                weight: isSelected ? 3 : 0,
              }}
              eventHandlers={{
                click: (event) => {
                  setSelectedEvent(selectedEvent === marker.eventName ? null : marker.eventName);
                  event.target.openPopup();
                },
              }}
            >
              <Popup autoPan={false}><MarkerPopup marker={marker} /></Popup>
            </CircleMarker>
          );
        })
      }
    </>
  );
}
