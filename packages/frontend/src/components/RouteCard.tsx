import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin,
  Clock,
  Navigation,
  ChevronDown,
  ExternalLink,
  Star
} from 'lucide-react';
import { Button } from './ui/button';
import type { GeneratedRoute } from '@mappy/shared';
import { RouteMap } from './RouteMap';

interface RouteCardProps {
  route: GeneratedRoute;
  index: number;
  distanceUnit: 'miles' | 'km';
  apiKey?: string;
}

export function RouteCard({ route, index, distanceUnit, apiKey }: RouteCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const formatDistance = (meters: number) => {
    if (distanceUnit === 'km') {
      return `${(meters / 1000).toFixed(1)} km`;
    }
    return `${(meters / 1609.34).toFixed(1)} mi`;
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  };

  // Convert waypoints to display format (use coordinates or POI names if available)
  const waypointNames = route.waypoints.map((wp, i) => {
    // If we have POIs, try to match waypoints to POI names
    if (route.pois && route.pois.length > i) {
      return route.pois[i].name;
    }
    // Otherwise show coordinates
    return `${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)}`;
  });

  return (
    <motion.div
      initial={{
        opacity: 0,
        y: 20
      }}
      animate={{
        opacity: 1,
        y: 0
      }}
      transition={{
        delay: index * 0.1,
        duration: 0.5,
        ease: [0.22, 1, 0.36, 1]
      }}
      className="group">
      <div className="bg-card border border-border rounded-2xl overflow-hidden hover:shadow-xl hover:border-primary/20 transition-all duration-500 shadow-sm">
        {/* Map Preview */}
        <div className="relative h-56 bg-secondary/50 overflow-hidden">
          <div className="w-full h-full relative z-0">
            <RouteMap route={route} apiKey={apiKey} />
          </div>
          <div className="absolute inset-0 bg-linear-to-t from-background via-transparent to-transparent pointer-events-none z-10" />

          {/* Rating Badge */}
          {route.scores.composite > 0 &&
            <div className="absolute top-4 right-4 bg-background/90 backdrop-blur-md px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm border border-border">
              <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
              <span className="text-sm font-bold text-foreground">
                {route.scores.composite.toFixed(1)}
              </span>
            </div>
          }
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Header */}
          <div>
            <h3 className="text-xl font-bold text-foreground mb-3 leading-tight">
              {route.narrative.summary || 'Generated Route'}
            </h3>
            <div className="flex flex-wrap gap-5 text-sm font-medium text-muted-foreground">
              <div className="flex items-center gap-2">
                <Navigation className="w-4 h-4 text-primary" />
                <span>{formatDistance(route.metadata.distance)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                <span>{formatDuration(route.metadata.duration)}</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" />
                <span>{route.waypoints.length} stops</span>
              </div>
            </div>
          </div>

          {/* Highlights */}
          {route.narrative.highlights && route.narrative.highlights.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {route.narrative.highlights.slice(0, 3).map((highlight, i) =>
                <span
                  key={i}
                  className="px-3 py-1 bg-primary/5 border border-primary/10 rounded-full text-xs font-semibold text-primary">
                  {highlight}
                </span>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              onClick={() => window.open(route.export.maps_url, '_blank')}
              className="flex-2 gap-2 font-bold shadow-lg bg-zinc-950 text-white hover:bg-zinc-800 border-b-2 border-zinc-800 active:border-b-0 active:translate-y-0.5">
              <ExternalLink className="w-4 h-4" />
              Start Navigation
            </Button>
            <Button
              variant="outline"
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex-1 gap-2 font-bold border-2 border-zinc-200 shadow-sm bg-background hover:bg-zinc-50">
              Details
              <motion.div
                animate={{
                  rotate: isExpanded ? 180 : 0
                }}
                transition={{
                  duration: 0.3
                }}>
                <ChevronDown className="w-4 h-4" />
              </motion.div>
            </Button>
          </div>

          {/* Expandable Details */}
          <AnimatePresence>
            {isExpanded &&
              <motion.div
                initial={{
                  height: 0,
                  opacity: 0
                }}
                animate={{
                  height: 'auto',
                  opacity: 1
                }}
                exit={{
                  height: 0,
                  opacity: 0
                }}
                transition={{
                  duration: 0.3,
                  ease: [0.22, 1, 0.36, 1]
                }}
                className="overflow-hidden">
                <div className="pt-6 border-t border-border space-y-5">
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      Proposed Waypoints
                    </h4>
                    <ul className="space-y-3">
                      {waypointNames.map((waypoint, i) =>
                        <li
                          key={i}
                          className="flex items-start gap-3 text-sm font-medium text-foreground">
                          <span className="flex-none w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold text-primary border border-primary/10">
                            {i + 1}
                          </span>
                          <span className="pt-0.5">{waypoint}</span>
                        </li>
                      )}
                    </ul>
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      Route Characteristics
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {route.narrative.highlights && route.narrative.highlights.length > 0 ? (
                        route.narrative.highlights.map((highlight, i) =>
                          <span
                            key={i}
                            className="px-2.5 py-1 bg-secondary border border-border rounded-lg text-[11px] font-semibold text-foreground">
                            {highlight}
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground italic">
                          Standard optimization metrics applied
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            }
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
