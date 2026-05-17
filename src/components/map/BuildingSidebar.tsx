import { useEffect, useMemo, useRef, useState } from 'react';
import { useUiStore } from '../../store/uiStore';
import { useServerStore } from '../../store/serverStore';
import { sampleTierAtPos, sampleUsageAtPos, hasCeToolBitmaps } from '../../lib/tierZoneResolver';
import { BuildingPopup } from './BuildingPopup';

export function BuildingSidebar({ onWidthChange }: { onWidthChange?: (w: number) => void }) {
  const selectedBuildingType = useUiStore(s => s.selectedBuildingType);
  const selectedBuildingSeq = useUiStore(s => s.selectedBuildingSeq);
  const buildingInstances = useServerStore(s => s.buildingInstances);
  const minExpandedWidth = 320;
  const maxExpandedWidth = 760;
  const collapsedWidth = 44;
  const [expanded, setExpanded] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(384);
  const resizingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(sidebarWidth);

  useEffect(() => {
    onWidthChange?.(expanded ? sidebarWidth : collapsedWidth);
  }, [expanded, sidebarWidth]);

  const tierZonesLoaded = useUiStore(s => s.tierZonesLoaded);
  const selectedBuildingPos = useUiStore(s => s.selectedBuildingPos);
  const territoryBitmaps = useServerStore(s => s.territoryBitmaps);
  const useZoneData = tierZonesLoaded || (territoryBitmaps.size > 0 && hasCeToolBitmaps());

  const building = useMemo(() => {
    if (!selectedBuildingType) return null;
    return buildingInstances.find(b => b.typeName.trim().toLowerCase() === selectedBuildingType.toLowerCase()) || null;
  }, [selectedBuildingType, buildingInstances]);

  const samplePos = selectedBuildingPos ?? (building ? { x: building.x, z: building.z } : null);

  const zoneTier = useMemo(() => {
    if (!samplePos || !useZoneData) return null;
    const t = sampleTierAtPos(samplePos.x, samplePos.z);
    return t !== 'unknown' ? t : null;
  }, [samplePos, useZoneData, territoryBitmaps]);

  const zoneUsage = useMemo(() => {
    if (!samplePos || !useZoneData) return building?.usages[0] ?? null;
    return sampleUsageAtPos(samplePos.x, samplePos.z) ?? building?.usages[0] ?? null;
  }, [samplePos, useZoneData, territoryBitmaps, building]);


  useEffect(() => {
    if (selectedBuildingType) {
      setExpanded(true);
    } else {
      setExpanded(false);
    }
  }, [selectedBuildingSeq, selectedBuildingType]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!resizingRef.current || !expanded) return;
      const delta = event.clientX - dragStartXRef.current;
      const next = Math.max(minExpandedWidth, Math.min(maxExpandedWidth, dragStartWidthRef.current + delta));
      setSidebarWidth(next);
    };

    const onMouseUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [expanded]);

  const startResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startWidth = expanded ? sidebarWidth : minExpandedWidth;
    if (!expanded) {
      setExpanded(true);
      setSidebarWidth(startWidth);
    }
    resizingRef.current = true;
    setIsResizing(true);
    dragStartXRef.current = event.clientX;
    dragStartWidthRef.current = startWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const toggleExpanded = () => {
    setExpanded(prev => {
      const next = !prev;
      if (next && sidebarWidth < minExpandedWidth) {
        setSidebarWidth(384);
      }
      return next;
    });
  };

  return (
    <div
      className={`absolute left-0 top-0 h-full z-[500] bg-slate-900 border-r border-slate-700 flex flex-col overflow-hidden pointer-events-none ${isResizing ? '' : 'transition-[width] duration-150 ease-out'}`}
      style={{ width: expanded ? sidebarWidth : collapsedWidth }}
    >
      <div className={`pointer-events-auto ${expanded ? 'px-4 py-3' : 'px-2 py-2'} border-b border-slate-700 flex items-start ${expanded ? 'justify-between' : 'justify-center'} gap-2 flex-shrink-0`}>
        {expanded && (
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-100 truncate">Building Editor</h2>
            <p className="text-xs text-slate-400 mt-0.5">{building?.typeName ?? 'No building selected'}</p>
          </div>
        )}
        <button
          onClick={toggleExpanded}
          className={`${expanded ? 'w-5 h-5' : 'w-7 h-7'} rounded border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 flex items-center justify-center transition-colors flex-shrink-0`}
          title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={expanded ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'} />
          </svg>
        </button>
      </div>

      <div className="pointer-events-auto flex-1 min-h-0">
        {expanded && building && (
          <BuildingPopup
            building={building}
            tiers={building.tiers.length > 0 ? building.tiers : ['unknown']}
            zoneUsage={zoneUsage}
            zoneTier={zoneTier}
            protoTiers={building.tiers}
            embedded
          />
        )}
        {expanded && !building && (
          <div className="h-full flex items-center justify-center text-xs text-slate-500 px-4 text-center">
            Click a building marker to open the editor.
          </div>
        )}
      </div>

      <div
        onMouseDown={startResize}
        className="pointer-events-auto absolute top-0 right-0 h-full w-2 cursor-col-resize group"
        title="Drag to resize sidebar"
      >
        <div className="absolute top-1/2 -translate-y-1/2 right-0 w-[2px] h-14 bg-slate-600/70 group-hover:bg-slate-400" />
        <div className="absolute top-1/2 -translate-y-1/2 right-0 w-[2px] h-6 bg-slate-300/90" />
        <div className="absolute inset-y-0 -right-1 w-3" />
        </div>
      
    </div>
  );
}
