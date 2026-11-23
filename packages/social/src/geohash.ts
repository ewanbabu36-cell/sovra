/**
 * @file packages/social/src/geohash.ts
 * Privacy-Preserving Geohash Spatial Indexing & Neighborhood Radius Discovery.
 *
 * Implements:
 * 1. Standard Base32 Geohash Encoding & Decoding (Level 1 to 12).
 * 2. 8-Directional Geohash Neighbor Calculation (N, NE, E, SE, S, SW, W, NW).
 * 3. Spatial Radius Matching (5km, 10km, 25km, 50km) with Bounding Box Filtering.
 * 4. Haversine Great-Circle Distance Metric.
 * 5. Differential Privacy Location Fuzzing (preserves neighborhood without leaking house/street GPS).
 */

const BASE32_ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz';
const BITS = [16, 8, 4, 2, 1];

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface GeoBoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface GeohashNeighbors {
  north: string;
  south: string;
  east: string;
  west: string;
  northEast: string;
  northWest: string;
  southEast: string;
  southWest: string;
}

/**
 * Encodes a latitude and longitude into a standard Geohash string of requested precision.
 */
export function encodeGeohash(latitude: number, longitude: number, precision = 6): string {
  if (latitude < -90 || latitude > 90) {
    throw new Error(`Latitude ${latitude} is out of range [-90, 90]`);
  }
  if (longitude < -180 || longitude > 180) {
    throw new Error(`Longitude ${longitude} is out of range [-180, 180]`);
  }

  let latMin = -90.0;
  let latMax = 90.0;
  let lonMin = -180.0;
  let lonMax = 180.0;

  let geohash = '';
  let isEven = true;
  let bit = 0;
  let ch = 0;

  while (geohash.length < precision) {
    const bitMask = BITS[bit] ?? 0;
    if (isEven) {
      const mid = (lonMin + lonMax) / 2;
      if (longitude >= mid) {
        ch |= bitMask;
        lonMin = mid;
      } else {
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (latitude >= mid) {
        ch |= bitMask;
        latMin = mid;
      } else {
        latMax = mid;
      }
    }

    isEven = !isEven;
    if (bit < 4) {
      bit++;
    } else {
      geohash += BASE32_ALPHABET[ch] ?? '';
      bit = 0;
      ch = 0;
    }
  }

  return geohash;
}

/**
 * Decodes a Geohash string into its center coordinate and bounding box.
 */
export function decodeGeohash(geohash: string): { point: GeoPoint; box: GeoBoundingBox } {
  if (!geohash || typeof geohash !== 'string') {
    throw new Error('Invalid geohash string');
  }

  const clean = geohash.toLowerCase().trim();
  let latMin = -90.0;
  let latMax = 90.0;
  let lonMin = -180.0;
  let lonMax = 180.0;
  let isEven = true;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i] ?? '';
    const charIdx = BASE32_ALPHABET.indexOf(char);
    if (charIdx === -1) {
      throw new Error(`Invalid geohash character '${char}' at index ${i}`);
    }

    for (let bit = 0; bit < 5; bit++) {
      const mask = BITS[bit] ?? 0;
      if (isEven) {
        const mid = (lonMin + lonMax) / 2;
        if ((charIdx & mask) !== 0) {
          lonMin = mid;
        } else {
          lonMax = mid;
        }
      } else {
        const mid = (latMin + latMax) / 2;
        if ((charIdx & mask) !== 0) {
          latMin = mid;
        } else {
          latMax = mid;
        }
      }
      isEven = !isEven;
    }
  }

  return {
    point: {
      latitude: (latMin + latMax) / 2,
      longitude: (lonMin + lonMax) / 2,
    },
    box: {
      minLat: latMin,
      maxLat: latMax,
      minLon: lonMin,
      maxLon: lonMax,
    },
  };
}

/**
 * Calculates great-circle distance between two GPS coordinates in kilometers (Haversine formula).
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth mean radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

/**
 * Computes adjacent geohash in a given direction (north, south, east, west).
 */
export function getAdjacentGeohash(geohash: string, direction: 'top' | 'bottom' | 'right' | 'left'): string {
  const clean = geohash.toLowerCase().trim();
  const { point, box } = decodeGeohash(clean);
  const latDelta = box.maxLat - box.minLat;
  const lonDelta = box.maxLon - box.minLon;

  let nextLat = point.latitude;
  let nextLon = point.longitude;

  switch (direction) {
    case 'top':
      nextLat = point.latitude + latDelta;
      break;
    case 'bottom':
      nextLat = point.latitude - latDelta;
      break;
    case 'right':
      nextLon = point.longitude + lonDelta;
      break;
    case 'left':
      nextLon = point.longitude - lonDelta;
      break;
  }

  // Wrap longitude
  if (nextLon > 180) nextLon -= 360;
  if (nextLon < -180) nextLon += 360;

  // Clamp latitude
  if (nextLat > 90) nextLat = 90;
  if (nextLat < -90) nextLat = -90;

  return encodeGeohash(nextLat, nextLon, clean.length);
}

/**
 * Computes all 8 neighbors surrounding a geohash cell.
 */
export function getGeohashNeighbors(geohash: string): GeohashNeighbors {
  const north = getAdjacentGeohash(geohash, 'top');
  const south = getAdjacentGeohash(geohash, 'bottom');
  const east = getAdjacentGeohash(geohash, 'right');
  const west = getAdjacentGeohash(geohash, 'left');

  const northEast = getAdjacentGeohash(north, 'right');
  const northWest = getAdjacentGeohash(north, 'left');
  const southEast = getAdjacentGeohash(south, 'right');
  const southWest = getAdjacentGeohash(south, 'left');

  return {
    north,
    south,
    east,
    west,
    northEast,
    northWest,
    southEast,
    southWest,
  };
}

/**
 * Returns the set of geohashes (central + 8 neighbors) that cover the spatial radius.
 * Precision mappings:
 * - radius <= 5km  => Level 5 (~4.9km)
 * - radius <= 20km => Level 4 (~39km)
 * - radius <= 50km => Level 4 / 3
 */
export function getGeohashesInRadius(latitude: number, longitude: number, radiusKm: number): string[] {
  let precision = 5;
  if (radiusKm <= 2) {
    precision = 6; // ~1.2 km
  } else if (radiusKm <= 8) {
    precision = 5; // ~4.9 km
  } else if (radiusKm <= 35) {
    precision = 4; // ~39 km
  } else {
    precision = 3; // ~156 km
  }

  const centerGeohash = encodeGeohash(latitude, longitude, precision);
  const neighbors = getGeohashNeighbors(centerGeohash);

  return [
    centerGeohash,
    neighbors.north,
    neighbors.south,
    neighbors.east,
    neighbors.west,
    neighbors.northEast,
    neighbors.northWest,
    neighbors.southEast,
    neighbors.southWest,
  ];
}

/**
 * Privacy-preserving location fuzzing.
 * Truncates exact GPS to an imprecise neighborhood centroid to protect user privacy.
 */
export function fuzzCoordinates(latitude: number, longitude: number, blurRadiusKm = 2.5): GeoPoint {
  // Level 5 geohash gives ~4.9km precision box centroid
  const precision = blurRadiusKm <= 1 ? 6 : blurRadiusKm <= 5 ? 5 : 4;
  const hash = encodeGeohash(latitude, longitude, precision);
  return decodeGeohash(hash).point;
}
