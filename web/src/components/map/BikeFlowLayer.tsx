import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import type { ActiveRideV2 } from '../../types/scenario';
import { STATIONS } from '../../data/stations';
import { MAX_VISIBLE_RIDES } from '../../data/constants';

interface Props {
  rides: ActiveRideV2[];
}

// Compute a bezier curve control point for arc between two points
function controlPoint(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): [number, number] {
  const dx = lng2 - lng1;
  const dy = lat2 - lat1;
  return [(lat1 + lat2) / 2 + dx * 0.3, (lng1 + lng2) / 2 - dy * 0.3];
}

function bezierPoint(
  t: number,
  lat1: number, lng1: number,
  cpLat: number, cpLng: number,
  lat2: number, lng2: number,
): [number, number] {
  const u = 1 - t;
  return [
    u * u * lat1 + 2 * u * t * cpLat + t * t * lat2,
    u * u * lng1 + 2 * u * t * cpLng + t * t * lng2,
  ];
}

export default function BikeFlowLayer({ rides }: Props) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ridesRef = useRef<ActiveRideV2[]>([]);
  ridesRef.current = rides;

  useEffect(() => {
    const container = map.getContainer();
    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '450';
      container.appendChild(canvas);
      canvasRef.current = canvas;
    }

    const resize = () => {
      const size = map.getSize();
      canvas!.width = size.x;
      canvas!.height = size.y;
    };
    resize();
    map.on('resize', resize);
    map.on('move', draw);
    map.on('zoom', draw);

    function draw() {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const visibleRides = ridesRef.current.slice(0, MAX_VISIBLE_RIDES);
      for (const ride of visibleRides) {
        const origin = STATIONS[ride.origin];
        const dest = STATIONS[ride.destination];
        if (!origin || !dest) continue;

        const [cpLat, cpLng] = controlPoint(
          origin.latitude, origin.longitude,
          dest.latitude, dest.longitude,
        );

        const [lat, lng] = bezierPoint(
          ride.progress,
          origin.latitude, origin.longitude,
          cpLat, cpLng,
          dest.latitude, dest.longitude,
        );

        const point = map.latLngToContainerPoint([lat, lng]);

        ctx.beginPath();
        ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(59, 130, 246, ${0.5 + ride.progress * 0.5})`;
        ctx.fill();
      }
    }

    draw();

    let rafId: number;
    function loop() {
      draw();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      map.off('resize', resize);
      map.off('move', draw);
      map.off('zoom', draw);
      if (canvas && canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
      canvasRef.current = null;
    };
  }, [map]);

  return null;
}
