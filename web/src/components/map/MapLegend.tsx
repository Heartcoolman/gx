import { useMap } from 'react-leaflet';
import { useEffect, useRef } from 'react';
import L from 'leaflet';
const LEGEND_ITEMS = [
  { color: '#ef4444', label: '紧缺 (<30%)' },
  { color: '#eab308', label: '适中 (30-60%)' },
  { color: '#22c55e', label: '充足 (60-80%)' },
  { color: '#3b82f6', label: '过剩 (>80%)' },
];

export default function MapLegend() {
  const map = useMap();
  const controlRef = useRef<L.Control | null>(null);

  useEffect(() => {
    const LegendControl = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'leaflet-control');
        div.style.background = 'rgba(255,255,255,0.95)';
        div.style.padding = '10px 14px';
        div.style.borderRadius = '8px';
        div.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
        div.style.fontSize = '12px';
        div.style.lineHeight = '1.8';

        div.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">站点状态</div>' +
          LEGEND_ITEMS.map(({ color, label }) =>
            `<div><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle;"></span>${label}</div>`
          ).join('') +
          '<div style="margin-top:6px;font-weight:600;">现实度图层</div>' +
          '<div>蓝点: 在途骑行</div>' +
          '<div>橙色压力: 站点短时拥堵</div>' +
          '<div>坏车/维修请看站点 tooltip</div>';
        return div;
      },
    });

    const control = new LegendControl({ position: 'bottomright' });
    control.addTo(map);
    controlRef.current = control;

    return () => {
      if (controlRef.current) {
        map.removeControl(controlRef.current);
      }
    };
  }, [map]);

  return null;
}
