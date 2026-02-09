/**
 * Route Generator Component
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin,
  Plus,
  Navigation,
  X,
  Sparkles,
  Loader2,
  Settings,
  Key,
  ChevronDown,
  Trash2,
  XIcon
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { RouteCard } from './RouteCard';
import { MappyLogo } from './MappyLogo';
import { ThemeToggle } from './ThemeToggle';
import { cn } from '../lib/utils';
import { useRouteStore } from '../store/routeStore';
import { RouteAPI } from '../api/client';
import { ROUTE_MODE } from '@mappy/shared';

interface GeocodeResult {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  city?: string;
  state?: string;
  country?: string;
}

export function RouteGenerator() {
  const {
    preferences,
    location,
    routeType,
    distanceUnit,
    apiKeys,
    route,
    error,
    addPreference,
    removePreference,
    setLocation: setLocationInStore,
    setRouteType: setRouteTypeInStore,
    setDistanceUnit,
    setApiKeys,
    setRoute,
    setError,
    clearAll,
  } = useRouteStore();

  const [prefInput, setPrefInput] = useState('');
  const [locationText, setLocationText] = useState('');
  const [locationSuggestions, setLocationSuggestions] = useState<GeocodeResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressSteps, setProgressSteps] = useState<Array<{ step: string; message: string; completed: boolean }>>([]);
  const [manualCoords, setManualCoords] = useState({ lat: '', lng: '' });
  const [showManualCoords, setShowManualCoords] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [localApiKeys, setLocalApiKeys] = useState({ gemini: apiKeys.gemini || '', googleMaps: apiKeys.googleMaps || '' });
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const apiRef = useRef(new RouteAPI());
  const progressStepsRef = useRef<HTMLDivElement>(null);

  // Server warmup: Fire health check on mount to wake up cold-started servers
  useEffect(() => {
    const warmupServer = async () => {
      try {
        await apiRef.current.healthCheck();
        console.log('✅ Server warmed up and ready');
      } catch (error) {
        // Silently ignore warmup errors - server might still wake up
        console.log('⏳ Server warming up...');
      }
    };

    // Initial warmup
    warmupServer();

    // Keep-alive: Ping every 5 minutes to prevent cold starts during active sessions
    const keepAliveInterval = setInterval(() => {
      apiRef.current.healthCheck().catch(() => {
        // Ignore errors - this is just a keep-alive
      });
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(keepAliveInterval);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (location) {
      if (location.type === 'current') {
        setLocationText('Current Location');
      } else if (location.address) {
        setLocationText(location.address);
      } else if (location.coordinates) {
        setLocationText(`${location.coordinates.lat}, ${location.coordinates.lng}`);
        setManualCoords({
          lat: location.coordinates.lat.toString(),
          lng: location.coordinates.lng.toString(),
        });
      }
    }
  }, [location]);

  // Auto-scroll to bottom when new progress step is added
  useEffect(() => {
    if (progressStepsRef.current) {
      progressStepsRef.current.scrollTop = progressStepsRef.current.scrollHeight;
    }
  }, [progressSteps]);

  const addPreferenceHandler = () => {
    if (prefInput.trim()) {
      addPreference({ text: prefInput.trim() });
      setPrefInput('');
    }
  };

  const geocodeLocation = useCallback(async (text: string) => {
    if (text.trim().length < 3) {
      setLocationSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setIsGeocoding(true);
    try {
      const response = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=5&lang=en`,
        {
          headers: {
            'Accept': 'application/json',
          },
        }
      );
      const data = await response.json();
      
      const results: GeocodeResult[] = (data.features || []).map((feature: {
        geometry: { coordinates: [number, number] };
        properties: { name?: string; city?: string; state?: string; country?: string };
      }) => {
        const props = feature.properties;
        const parts = [props.name, props.city, props.state, props.country].filter(Boolean);
        return {
          lat: String(feature.geometry.coordinates[1]),
          lon: String(feature.geometry.coordinates[0]),
          display_name: parts.join(', '),
          name: props.name,
          city: props.city,
          state: props.state,
          country: props.country,
        };
      });
      
      setLocationSuggestions(results);
      setShowSuggestions(results.length > 0);
    } catch (err) {
      console.error('Geocoding error:', err);
    } finally {
      setIsGeocoding(false);
    }
  }, []);

  const handleLocationInput = (text: string) => {
    setLocationText(text);

    const coordMatch = text.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        setLocationInStore({
          type: 'custom',
          coordinates: { lat, lng },
        });
        setManualCoords({ lat: lat.toString(), lng: lng.toString() });
        setShowSuggestions(false);
        return;
      }
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      geocodeLocation(text);
    }, 300);
  };

  const selectSuggestion = (suggestion: GeocodeResult) => {
    setLocationText(suggestion.display_name);
    setLocationInStore({
      type: 'custom',
      coordinates: {
        lat: parseFloat(suggestion.lat),
        lng: parseFloat(suggestion.lon),
      },
      address: suggestion.display_name,
    });
    setShowSuggestions(false);
  };

  const handleManualCoords = () => {
    const lat = parseFloat(manualCoords.lat);
    const lng = parseFloat(manualCoords.lng);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      setLocationInStore({
        type: 'custom',
        coordinates: { lat, lng },
      });
      setLocationText(`${lat}, ${lng}`);
      setShowManualCoords(false);
    } else {
      setError('Invalid coordinates. Latitude must be between -90 and 90, longitude between -180 and 180.');
    }
  };

  const handleCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocationInStore({
            type: 'current',
            coordinates: {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            },
          });
          setLocationText('Current Location');
        },
        (error) => {
          setError('Failed to get current location. Please enable location permissions.');
          console.error('Geolocation error:', error);
        }
      );
    } else {
      setError('Geolocation is not supported by your browser.');
    }
  };

  const handleSaveApiKeys = () => {
    setApiKeys({
      gemini: localApiKeys.gemini.trim() || undefined,
      googleMaps: localApiKeys.googleMaps.trim() || undefined,
    });
    setShowApiKeys(false);
  };

  const generateRoutes = async () => {
    if (preferences.length === 0) {
      setError('Add at least one preference');
      return;
    }

    if (!location) {
      setError('Please enter a location');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setProgressSteps([]);

    try {
      const keysToSend =
        localApiKeys.gemini.trim() || localApiKeys.googleMaps.trim()
          ? {
              gemini: localApiKeys.gemini.trim() || undefined,
              googleMaps: localApiKeys.googleMaps.trim() || undefined,
            }
          : Object.keys(apiKeys).length > 0
            ? apiKeys
            : undefined;

      const result = await apiRef.current.generateRouteWithProgress(
        {
          preferences,
          location,
          context: {
            routeType,
            preferredDistanceUnit: distanceUnit,
          },
          apiKeys: keysToSend,
        },
        (event) => {
          // Update progress steps: mark previous as complete, add new as current
          setProgressSteps((prev) => {
            const updated = prev.map(s => ({ ...s, completed: true }));
            return [...updated, { step: event.step, message: event.message, completed: false }];
          });
        }
      );

      setRoute(result.routes);
      
      // Mark all steps as completed
      setProgressSteps((prev) => prev.map(s => ({ ...s, completed: true })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate routes. Please try again.');
    } finally {
      setTimeout(() => {
        setIsGenerating(false);
        setProgressSteps([]);
      }, 1000);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 text-foreground">
                <MappyLogo />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">Mappy</h1>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">AI Route Planning</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="cyan" className="gap-1.5 px-3 py-1 font-semibold">
                <Sparkles className="w-3.5 h-3.5" />
                AI Powered
              </Badge>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid lg:grid-cols-2 gap-12">
          <div className="space-y-12">
            <div className="space-y-6">
              <div>
                <h2 className="text-3xl font-bold tracking-tight text-foreground mb-2">
                  What are you looking for?
                </h2>
                <p className="text-muted-foreground">
                  Add your route preferences to guide our AI
                </p>
              </div>

              <div className="flex gap-3">
                <Input
                  placeholder="e.g., local coffee shops, scenic overlooks..."
                  value={prefInput}
                  onChange={(e) => setPrefInput(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && (e.preventDefault(), addPreferenceHandler())
                  }
                  className="flex-1 h-12 text-base" />

                <Button 
                  onClick={addPreferenceHandler} 
                  size="lg" 
                  className="px-6 h-12 shadow-lg border-b-2 border-primary/80 active:border-b-0 active:translate-y-0.5"
                >
                  <Plus className="w-5 h-5 mr-2" />
                  <span className="font-bold">Add</span>
                </Button>
              </div>

              {preferences.length > 0 &&
                <motion.div
                  className="flex flex-wrap gap-2.5"
                  initial={{
                    opacity: 0
                  }}
                  animate={{
                    opacity: 1
                  }}>
                  {preferences.map((pref, i) =>
                    <motion.div
                      key={i}
                      initial={{
                        scale: 0.8,
                        opacity: 0
                      }}
                      animate={{
                        scale: 1,
                        opacity: 1
                      }}
                      className="group bg-secondary border border-border px-4 py-2 rounded-full text-sm font-medium text-secondary-foreground flex items-center gap-2 hover:bg-accent transition-colors shadow-sm">
                      {pref.text}
                      <button
                        onClick={() => removePreference(i)}
                        className="text-muted-foreground hover:text-destructive transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </motion.div>
                  )}
                </motion.div>
              }
            </div>

            <div className="space-y-6">
              <div>
                <h2 className="text-3xl font-bold tracking-tight text-foreground mb-2">Where?</h2>
                <p className="text-muted-foreground">
                  Enter your starting location or use current GPS
                </p>
              </div>

              <div className="relative" ref={suggestionsRef}>
                <Input
                  placeholder="City, address, or coordinates (lat, lng)..."
                  value={locationText}
                  onChange={(e) => handleLocationInput(e.target.value)}
                  onFocus={() => locationSuggestions.length > 0 && setShowSuggestions(true)}
                  className="h-12 text-base" />
                
                {isGeocoding && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                {locationText && !isGeocoding && (
                  <button
                    type="button"
                    onClick={() => {
                      setLocationText('');
                      setLocationInStore(null);
                      setLocationSuggestions([]);
                      setShowSuggestions(false);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer hover:text-foreground transition-colors">
                    <XIcon className="w-4 h-4 text-muted-foreground" />
                  </button>
                )}

                {/* Autocomplete Suggestions */}
                <AnimatePresence>
                  {showSuggestions && locationSuggestions.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute z-50 w-full mt-2 bg-card border border-border rounded-xl shadow-2xl max-h-64 overflow-y-auto">
                      {locationSuggestions.map((suggestion, i) => (
                        <button
                          key={i}
                          onClick={() => selectSuggestion(suggestion)}
                          className="w-full text-left px-5 py-4 hover:bg-accent bg-card transition-colors border-b border-border last:border-b-0 cursor-pointer">
                          <p className="text-sm font-medium text-foreground">{suggestion.display_name}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {parseFloat(suggestion.lat).toFixed(4)}, {parseFloat(suggestion.lon).toFixed(4)}
                          </p>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  className="flex-1 h-11 gap-2 border-2 shadow-sm font-bold"
                  onClick={handleCurrentLocation}>
                  <Navigation className="w-4 h-4 text-primary" />
                  Use Current Location
                </Button>
                <Button
                  variant="secondary"
                  className="h-11 px-6 gap-2 border-2 shadow-sm font-bold"
                  onClick={() => setShowManualCoords(!showManualCoords)}>
                  <MapPin className="w-4 h-4 text-primary" />
                  Coords
                </Button>
              </div>

              {/* Manual Coordinates Input */}
              <AnimatePresence>
                {showManualCoords && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden">
                    <div className="p-6 bg-secondary/50 border border-border rounded-xl space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Latitude</label>
                          <Input
                            type="number"
                            step="any"
                            placeholder="e.g., 37.7749"
                            value={manualCoords.lat}
                            onChange={(e) => setManualCoords({ ...manualCoords, lat: e.target.value })}
                            className="h-10" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Longitude</label>
                          <Input
                            type="number"
                            step="any"
                            placeholder="e.g., -122.4194"
                            value={manualCoords.lng}
                            onChange={(e) => setManualCoords({ ...manualCoords, lng: e.target.value })}
                            className="h-10" />
                        </div>
                      </div>
                      <Button
                        onClick={handleManualCoords}
                        className="w-full h-10">
                        Set Coordinates
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Settings */}
            <div className="space-y-6 pt-6 border-t border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Settings className="w-4 h-4" />
                  <span className="text-sm font-semibold uppercase tracking-wider">Settings</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAll}
                  className="gap-2 text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-4 h-4" />
                  Clear All
                </Button>
              </div>

              {/* Route Type */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground">Route Planning Mode</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setRouteTypeInStore(ROUTE_MODE.WALK)}
                    className={cn(
                      'p-4 rounded-xl border transition-all text-sm font-semibold shadow-sm',
                      routeType === ROUTE_MODE.WALK ?
                        'border-primary bg-primary/5 text-primary ring-1 ring-primary' :
                        'border-border bg-background text-muted-foreground hover:border-muted-foreground/50'
                    )}>
                    Walk & Jog
                  </button>
                  <button
                    onClick={() => setRouteTypeInStore(ROUTE_MODE.EXPLORE)}
                    className={cn(
                      'p-4 rounded-xl border transition-all text-sm font-semibold shadow-sm',
                      routeType === ROUTE_MODE.EXPLORE ?
                        'border-primary bg-primary/5 text-primary ring-1 ring-primary' :
                        'border-border bg-background text-muted-foreground hover:border-muted-foreground/50'
                    )}>
                    City Explore
                  </button>
                </div>
              </div>

              {/* Distance Unit */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground">Distance Unit</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDistanceUnit('miles')}
                    className={cn(
                      'p-4 rounded-xl border transition-all text-sm font-semibold shadow-sm',
                      distanceUnit === 'miles' ?
                        'border-primary bg-primary/5 text-primary ring-1 ring-primary' :
                        'border-border bg-background text-muted-foreground hover:border-muted-foreground/50'
                    )}>
                    Miles (mi)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDistanceUnit('km')}
                    className={cn(
                      'p-4 rounded-xl border transition-all text-sm font-semibold shadow-sm',
                      distanceUnit === 'km' ?
                        'border-primary bg-primary/5 text-primary ring-1 ring-primary' :
                        'border-border bg-background text-muted-foreground hover:border-muted-foreground/50'
                    )}>
                    Kilometers (km)
                  </button>
                </div>
              </div>

              {/* API Keys */}
              <div className="space-y-3">
                <button
                  onClick={() => setShowApiKeys(!showApiKeys)}
                  className="w-full p-4 bg-background border border-border rounded-xl hover:border-muted-foreground/50 transition-all text-left flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-semibold text-foreground">
                      {apiKeys.gemini?.trim() && apiKeys.googleMaps?.trim() ? 'API keys set' : 'API Keys (Required)'}
                    </span>
                  </div>
                  <motion.div
                    animate={{ rotate: showApiKeys ? 180 : 0 }}
                    transition={{ duration: 0.3 }}>
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  </motion.div>
                </button>

                <AnimatePresence>
                  {showApiKeys && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden">
                      <div className="p-6 bg-secondary/30 border border-border rounded-xl space-y-5">
                        <div className="space-y-2">
                          <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider">
                            Gemini API Key
                            <a
                              href="https://aistudio.google.com/app/apikey"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-2 text-primary hover:underline font-normal normal-case">
                              (Get free key)
                            </a>
                          </label>
                          <Input
                            type="password"
                            value={localApiKeys.gemini}
                            onChange={(e) => setLocalApiKeys({ ...localApiKeys, gemini: e.target.value })}
                            placeholder="AIza..."
                            className="h-10" />
                        </div>

                        <div className="space-y-2">
                          <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider">
                            Google Maps API Key
                            <a
                              href="https://console.cloud.google.com/google/maps-apis"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-2 text-primary hover:underline font-normal normal-case">
                              (Get key)
                            </a>
                          </label>
                          <Input
                            type="password"
                            value={localApiKeys.googleMaps}
                            onChange={(e) => setLocalApiKeys({ ...localApiKeys, googleMaps: e.target.value })}
                            placeholder="AIza..."
                            className="h-10" />
                        </div>

                        <Button
                          onClick={handleSaveApiKeys}
                          className="w-full">
                          Save API Configuration
                        </Button>

                        <p className="text-xs text-muted-foreground text-center italic">
                          Keys are encrypted locally in your browser session.
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Generate Button - requires both API keys, location, and at least one preference */}
            {!(apiKeys.gemini?.trim() && apiKeys.googleMaps?.trim()) && (
              <p className="text-sm text-muted-foreground mb-2">Add your Gemini and Google Maps API keys in Settings above to generate routes.</p>
            )}
            <div className={`generate-button-wrapper shadow-xl ${!(isGenerating || !location || preferences.length === 0 || !apiKeys.gemini?.trim() || !apiKeys.googleMaps?.trim()) ? 'active' : ''}`}>
              <button
                className="generate-button-shimmer w-full h-full flex items-center justify-center text-lg font-bold transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={generateRoutes}
                disabled={isGenerating || !location || preferences.length === 0 || !apiKeys.gemini?.trim() || !apiKeys.googleMaps?.trim()}>
                {isGenerating ?
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    <span>Generating...</span>
                  </> :
                  <>
                    Generate Custom Routes
                  </>
                }
              </button>
            </div>

            {/* Error Display */}
            {error && (
              <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-xl">
                <div className="flex items-start">
                  <X className="w-5 h-5 text-destructive mt-0.5 mr-3 shrink-0" />
                  <p className="text-sm text-destructive font-semibold">{error}</p>
                </div>
              </div>
            )}
          </div>

          {/* Right Side - Results */}
          <div className="lg:sticky lg:top-28 lg:h-[calc(100vh-10rem)]">
            <AnimatePresence mode="wait">
              {isGenerating ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="h-full flex flex-col items-center justify-start bg-secondary/30 border border-dashed border-border rounded-3xl p-12 overflow-hidden">
                  <div className="text-center max-w-md w-full shrink-0">
                    {/* Fixed header section */}
                    <div className="w-32 h-32 mx-auto text-foreground mb-6">
                      <MappyLogo animate />
                    </div>
                    <h3 className="text-2xl font-bold text-foreground mb-8">
                      Crafting Your Routes...
                    </h3>
                  </div>

                  {/* Scrollable Progress Steps Timeline */}
                  {progressSteps.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-background/50 backdrop-blur-sm border border-border rounded-2xl p-4 text-left w-full max-w-md flex-1 overflow-hidden flex flex-col">
                      <div ref={progressStepsRef} className="overflow-y-auto flex-1 pr-2 custom-scrollbar">
                        <div className="space-y-2">
                          {progressSteps.map((step, index) => (
                            <motion.div
                              key={`${step.step}-${index}`}
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: index * 0.05 }}
                              className={cn(
                                "flex items-start gap-3 p-3 rounded-lg transition-all",
                                !step.completed && "bg-primary/10 border border-primary/20"
                              )}>
                              <div className="shrink-0 mt-0.5">
                                {step.completed ? (
                                  <div className="w-5 h-5 rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center">
                                    <svg className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                  </div>
                                ) : (
                                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={cn(
                                  "text-sm font-medium leading-relaxed",
                                  step.completed ? "text-muted-foreground" : "text-foreground"
                                )}>
                                  {step.message}
                                </p>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              ) : !route || route.length === 0 ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="h-full flex items-center justify-center bg-secondary/30 border border-dashed border-border rounded-3xl p-12">
                  <div className="text-center space-y-6 max-w-sm">
                    <div className="w-24 h-24 bg-background border border-border rounded-3xl flex items-center justify-center mx-auto shadow-sm">
                      <MapPin className="w-10 h-10 text-muted-foreground/40" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-foreground mb-3">
                        Ready to Explore?
                      </h3>
                      <p className="text-muted-foreground leading-relaxed">
                        Customize your preferences and starting point on the left.
                        Our specialized AI will craft optimized routes just for you.
                      </p>
                    </div>
                  </div>
                </motion.div>
              ) :
                <motion.div
                  key="results"
                  initial={{
                    opacity: 0
                  }}
                  animate={{
                    opacity: 1
                  }}
                  exit={{
                    opacity: 0
                  }}
                  className="h-full space-y-8 overflow-y-auto pr-2 custom-scrollbar">
                  <div>
                    <h2 className="text-3xl font-bold tracking-tight text-foreground mb-2">
                      Optimized Routes
                    </h2>
                    <p className="text-muted-foreground">
                      We found {route.length} curated path{route.length > 1 ? 's' : ''} based on your preferences
                    </p>
                  </div>

                  <div className="space-y-6 pb-12">
                    {route.map((routeItem, index) =>
                      <RouteCard key={routeItem.id} route={routeItem} index={index} distanceUnit={distanceUnit} apiKey={apiKeys.googleMaps} />
                    )}
                  </div>
                </motion.div>
              }
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
