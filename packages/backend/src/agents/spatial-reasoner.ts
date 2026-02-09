import { getBoundsOfDistance } from "geolib";
import { haversineDistance } from "@mappy/shared";
import {
  DISTANCE_CONSTANTS,
  SPATIAL_CONSTANTS,
  ROUTE_MODE,
} from "../config/constants.js";
import type {
  LatLng,
  HardConstraint,
  SearchSpace,
  BoundingBox,
  RouteMode,
} from "@mappy/shared";

export class SpatialReasoner {
  computeSearchSpace(
    origin: LatLng,
    distanceConstraint: HardConstraint | null,
    routeType: RouteMode = ROUTE_MODE.WALK
  ): SearchSpace {
    let targetDistanceMeters = DISTANCE_CONSTANTS.DEFAULT_RADIUS_M;
    if (distanceConstraint?.type === "distance") {
      const distanceValue =
        typeof distanceConstraint.value === "number"
          ? distanceConstraint.value
          : DISTANCE_CONSTANTS.DEFAULT_DISTANCE_MILES;
      const distanceMiles =
        distanceConstraint.unit === "km"
          ? distanceValue * 0.621371
          : distanceValue;
      targetDistanceMeters = distanceMiles * 1609.34;
    }

    let searchRadiusMeters: number;

    if (routeType === ROUTE_MODE.WALK) {
      // For loops: radius = target / 6 to account for road distance factor (~1.7x in urban areas)
      // e.g. 5km loop:
      //   - Search radius: 5000m / 6 = 833m (straight-line)
      //   - 3 POIs at ~700m each (straight-line)
      //   - Actual road loop: ~700m × 1.7 × 4 segments ≈ 4.8km ✓
      searchRadiusMeters = targetDistanceMeters / 6;
    } else {
      searchRadiusMeters = Math.max(targetDistanceMeters, 5000);
    }
    const boundary = this.calculateBoundary(origin, searchRadiusMeters);

    const resolution = this.calculateOptimalResolution(searchRadiusMeters);
    const grid = this.createGrid(boundary, resolution);

    const graph = this.buildReachabilityGraph(grid);

    // Calculate metadata
    const area = this.calculateArea(boundary);
    const topologyType = this.inferTopologyType(origin);

    return {
      boundary: {
        type: "Polygon",
        coordinates: [
          [
            [boundary.west, boundary.south],
            [boundary.east, boundary.south],
            [boundary.west, boundary.north],
            [boundary.east, boundary.north],
            [boundary.west, boundary.south],
          ],
        ],
      },
      grid,
      graph,
      metadata: {
        area,
        cellCount: grid.cells.length,
        avgConnectivity: this.calculateAvgConnectivity(graph),
        topologyType,
      },
    };
  }

  /**
   * Bounding box for a center and radius (great-circle distance).
   * Uses geolib for correct handling of poles and longitude wrapping.
   */
  private calculateBoundary(center: LatLng, radiusMeters: number): BoundingBox {
    const [sw, ne] = getBoundsOfDistance(
      { latitude: center.lat, longitude: center.lng },
      radiusMeters
    );
    return {
      south: sw.latitude,
      west: sw.longitude,
      north: ne.latitude,
      east: ne.longitude,
    };
  }

  /**
   * Create a grid for a given bounding box and resolution.
   *
   * @param bounds - The bounding box.
   * @param resolutionMeters - The resolution of the grid.
   * @returns The grid.
   */
  private createGrid(bounds: BoundingBox, resolutionMeters: number) {
    const cells: Array<{
      id: string;
      center: LatLng;
      bounds: BoundingBox;
      accessible: boolean;
    }> = [];

    const avgLat = (bounds.north + bounds.south) / 2;
    const latStep = resolutionMeters / SPATIAL_CONSTANTS.METERS_PER_DEGREE_LAT;
    const lngStep =
      resolutionMeters /
      (SPATIAL_CONSTANTS.METERS_PER_DEGREE_LAT *
        Math.cos((avgLat * Math.PI) / 180));

    let cellId = 0;
    const maxCells = 400;
    let count = 0;

    for (
      let lat = bounds.south;
      lat <= bounds.north && count < maxCells;
      lat += latStep
    ) {
      for (
        let lng = bounds.west;
        lng <= bounds.east && count < maxCells;
        lng += lngStep
      ) {
        cells.push({
          id: `cell-${cellId++}`,
          center: { lat, lng },
          bounds: {
            north: lat + latStep,
            south: lat,
            east: lng + lngStep,
            west: lng,
          },
          accessible: true,
        });
        count++;
      }
    }

    return {
      cells,
      resolution: resolutionMeters,
      index: null,
    };
  }

  /**
   * Reachability graph: cells within CELL_CONNECTIVITY_THRESHOLD_M are connected.
   * Uses all pairs within distance (not index window) so connectivity is spatial.
   */
  private buildReachabilityGraph(grid: {
    cells: Array<{ id: string; center: LatLng }>;
  }) {
    const nodes = grid.cells.map((cell) => ({
      id: cell.id,
      location: cell.center,
      cellId: cell.id,
    }));

    const edges: Array<{
      from: string;
      to: string;
      distance: number;
      weight: number;
    }> = [];
    const adjacency = new Map<string, string[]>();
    const threshold = DISTANCE_CONSTANTS.CELL_CONNECTIVITY_THRESHOLD_M;

    for (let i = 0; i < nodes.length; i++) {
      const neighbors: string[] = [];
      for (let j = i + 1; j < nodes.length; j++) {
        const distance = haversineDistance(
          nodes[i].location,
          nodes[j].location
        );
        if (distance < threshold) {
          edges.push({
            from: nodes[i].id,
            to: nodes[j].id,
            distance,
            weight: distance,
          });
          neighbors.push(nodes[j].id);
          let jNeighbors = adjacency.get(nodes[j].id);
          if (jNeighbors === undefined) {
            jNeighbors = [];
            adjacency.set(nodes[j].id, jNeighbors);
          }
          jNeighbors.push(nodes[i].id);
        }
      }
      adjacency.set(nodes[i].id, neighbors);
    }

    return { nodes, edges, adjacency };
  }

  /**
   * Calculate the area of a given boundary.
   *
   * @param boundary - The boundary.
   * @returns The area in square kilometers.
   */
  private calculateArea(boundary: BoundingBox): number {
    const latDelta = boundary.north - boundary.south;
    const lngDelta = boundary.east - boundary.west;
    const avgLat = (boundary.north + boundary.south) / 2;

    return (
      ((((latDelta * SPATIAL_CONSTANTS.METERS_PER_DEGREE_LAT) / 1000) *
        lngDelta *
        SPATIAL_CONSTANTS.METERS_PER_DEGREE_LAT) /
        1000) *
      Math.cos((avgLat * Math.PI) / 180)
    );
  }

  /**
   * Calculate the average connectivity of a given graph.
   *
   * @param graph - The graph.
   * @returns The average connectivity.
   */
  private calculateAvgConnectivity(graph: {
    adjacency: Map<string, string[]>;
  }): number {
    if (graph.adjacency.size === 0) return 0;
    const totalConnections = Array.from(graph.adjacency.values()).reduce(
      (sum, neighbors) => sum + neighbors.length,
      0
    );
    return totalConnections / graph.adjacency.size;
  }

  /**
   * Calculate the optimal resolution for a given radius.
   *
   * @param radiusMeters - The radius in meters.
   * @returns The optimal resolution in meters.
   */
  private calculateOptimalResolution(radiusMeters: number): number {
    if (radiusMeters < SPATIAL_CONSTANTS.SMALL_ROUTE_THRESHOLD_M) {
      return SPATIAL_CONSTANTS.GRID_RESOLUTION_SMALL_M;
    }
    if (radiusMeters < SPATIAL_CONSTANTS.MEDIUM_ROUTE_THRESHOLD_M) {
      return SPATIAL_CONSTANTS.GRID_RESOLUTION_MEDIUM_M;
    }
    return Math.max(
      SPATIAL_CONSTANTS.GRID_RESOLUTION_LARGE_M,
      radiusMeters / 20
    );
  }

  /**
   * Topology type for metadata. Placeholder: could use density/land-use API later.
   */
  private inferTopologyType(_location: LatLng): "urban" | "suburban" | "rural" {
    return "urban";
  }
}
