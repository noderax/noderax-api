import type {
  NodeLocationDto,
  NodeLocationProvider,
  NodeLocationSource,
} from './dto/node-location.dto';
import {
  NODE_LOCATION_PROVIDERS,
  NODE_LOCATION_SOURCES,
} from './dto/node-location.dto';
import type { NodeEntity } from './entities/node.entity';

export type NodeLocationInput = {
  provider?: string | null;
  source?: string | null;
  region?: string | null;
  zone?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
};

export type NodeLocationFields = Pick<
  NodeEntity,
  | 'locationProvider'
  | 'locationSource'
  | 'locationRegion'
  | 'locationZone'
  | 'locationLatitude'
  | 'locationLongitude'
  | 'locationUpdatedAt'
>;

type RegionCoordinate = {
  lat: number;
  lng: number;
};

const REGION_COORDINATES: Record<
  CloudLocationProvider,
  Record<string, RegionCoordinate>
> = {
  aws: {
    'af-south-1': { lat: -33.9249, lng: 18.4241 },
    'ap-east-1': { lat: 22.3193, lng: 114.1694 },
    'ap-northeast-1': { lat: 35.6762, lng: 139.6503 },
    'ap-northeast-2': { lat: 37.5665, lng: 126.978 },
    'ap-northeast-3': { lat: 34.6937, lng: 135.5023 },
    'ap-south-1': { lat: 19.076, lng: 72.8777 },
    'ap-south-2': { lat: 17.385, lng: 78.4867 },
    'ap-southeast-1': { lat: 1.3521, lng: 103.8198 },
    'ap-southeast-2': { lat: -33.8688, lng: 151.2093 },
    'ap-southeast-3': { lat: -6.2088, lng: 106.8456 },
    'ap-southeast-4': { lat: -37.8136, lng: 144.9631 },
    'ap-southeast-5': { lat: 3.139, lng: 101.6869 },
    'ap-southeast-7': { lat: 13.7563, lng: 100.5018 },
    'ca-central-1': { lat: 45.5017, lng: -73.5673 },
    'ca-west-1': { lat: 51.0447, lng: -114.0719 },
    'cn-north-1': { lat: 39.9042, lng: 116.4074 },
    'cn-northwest-1': { lat: 38.2827, lng: 109.7453 },
    'eu-central-1': { lat: 50.1109, lng: 8.6821 },
    'eu-central-2': { lat: 47.3769, lng: 8.5417 },
    'eu-north-1': { lat: 59.3293, lng: 18.0686 },
    'eu-south-1': { lat: 45.4642, lng: 9.19 },
    'eu-south-2': { lat: 40.4168, lng: -3.7038 },
    'eu-west-1': { lat: 53.3498, lng: -6.2603 },
    'eu-west-2': { lat: 51.5072, lng: -0.1276 },
    'eu-west-3': { lat: 48.8566, lng: 2.3522 },
    'il-central-1': { lat: 32.0853, lng: 34.7818 },
    'me-central-1': { lat: 25.2048, lng: 55.2708 },
    'me-south-1': { lat: 26.2285, lng: 50.586 },
    'sa-east-1': { lat: -23.5558, lng: -46.6396 },
    'us-east-1': { lat: 39.0438, lng: -77.4874 },
    'us-east-2': { lat: 39.9612, lng: -82.9988 },
    'us-gov-east-1': { lat: 39.0438, lng: -77.4874 },
    'us-gov-west-1': { lat: 47.6062, lng: -122.3321 },
    'us-west-1': { lat: 37.3382, lng: -121.8863 },
    'us-west-2': { lat: 45.5152, lng: -122.6784 },
  },
  gcp: {
    'africa-south1': { lat: -26.2041, lng: 28.0473 },
    'asia-east1': { lat: 25.033, lng: 121.5654 },
    'asia-east2': { lat: 22.3193, lng: 114.1694 },
    'asia-northeast1': { lat: 35.6762, lng: 139.6503 },
    'asia-northeast2': { lat: 34.6937, lng: 135.5023 },
    'asia-northeast3': { lat: 37.5665, lng: 126.978 },
    'asia-south1': { lat: 19.076, lng: 72.8777 },
    'asia-south2': { lat: 28.6139, lng: 77.209 },
    'asia-southeast1': { lat: 1.3521, lng: 103.8198 },
    'asia-southeast2': { lat: -6.2088, lng: 106.8456 },
    'australia-southeast1': { lat: -33.8688, lng: 151.2093 },
    'australia-southeast2': { lat: -37.8136, lng: 144.9631 },
    'europe-central2': { lat: 52.2297, lng: 21.0122 },
    'europe-north1': { lat: 60.1699, lng: 24.9384 },
    'europe-southwest1': { lat: 40.4168, lng: -3.7038 },
    'europe-west1': { lat: 50.8503, lng: 4.3517 },
    'europe-west2': { lat: 51.5072, lng: -0.1276 },
    'europe-west3': { lat: 50.1109, lng: 8.6821 },
    'europe-west4': { lat: 52.3676, lng: 4.9041 },
    'europe-west6': { lat: 47.3769, lng: 8.5417 },
    'europe-west8': { lat: 45.4642, lng: 9.19 },
    'europe-west9': { lat: 48.8566, lng: 2.3522 },
    'europe-west10': { lat: 52.52, lng: 13.405 },
    'europe-west12': { lat: 45.0703, lng: 7.6869 },
    'me-central1': { lat: 25.2854, lng: 51.531 },
    'me-central2': { lat: 24.7136, lng: 46.6753 },
    'me-west1': { lat: 32.0853, lng: 34.7818 },
    'northamerica-northeast1': { lat: 45.5017, lng: -73.5673 },
    'northamerica-northeast2': { lat: 43.6532, lng: -79.3832 },
    'southamerica-east1': { lat: -23.5558, lng: -46.6396 },
    'southamerica-west1': { lat: -33.4489, lng: -70.6693 },
    'us-central1': { lat: 41.2619, lng: -95.8608 },
    'us-east1': { lat: 33.8361, lng: -81.1637 },
    'us-east4': { lat: 39.0438, lng: -77.4874 },
    'us-east5': { lat: 39.9612, lng: -82.9988 },
    'us-south1': { lat: 32.7767, lng: -96.797 },
    'us-west1': { lat: 45.5152, lng: -122.6784 },
    'us-west2': { lat: 34.0522, lng: -118.2437 },
    'us-west3': { lat: 40.7608, lng: -111.891 },
    'us-west4': { lat: 36.1699, lng: -115.1398 },
  },
  azure: {
    australiaeast: { lat: -33.8688, lng: 151.2093 },
    australiasoutheast: { lat: -37.8136, lng: 144.9631 },
    brazilsouth: { lat: -23.5558, lng: -46.6396 },
    canadacentral: { lat: 43.6532, lng: -79.3832 },
    canadaeast: { lat: 46.8139, lng: -71.2082 },
    centralindia: { lat: 18.5204, lng: 73.8567 },
    centralus: { lat: 41.2619, lng: -95.8608 },
    eastasia: { lat: 22.3193, lng: 114.1694 },
    eastus: { lat: 37.4316, lng: -78.6569 },
    eastus2: { lat: 36.6681, lng: -78.3889 },
    francecentral: { lat: 48.8566, lng: 2.3522 },
    germanywestcentral: { lat: 50.1109, lng: 8.6821 },
    israelcentral: { lat: 32.0853, lng: 34.7818 },
    italynorth: { lat: 45.4642, lng: 9.19 },
    japaneast: { lat: 35.6762, lng: 139.6503 },
    japanwest: { lat: 34.6937, lng: 135.5023 },
    koreacentral: { lat: 37.5665, lng: 126.978 },
    koreasouth: { lat: 35.1796, lng: 129.0756 },
    northcentralus: { lat: 41.8781, lng: -87.6298 },
    northeurope: { lat: 53.3498, lng: -6.2603 },
    norwayeast: { lat: 59.9139, lng: 10.7522 },
    polandcentral: { lat: 52.2297, lng: 21.0122 },
    qatarcentral: { lat: 25.2854, lng: 51.531 },
    southafricanorth: { lat: -26.2041, lng: 28.0473 },
    southcentralus: { lat: 29.7604, lng: -95.3698 },
    southeastasia: { lat: 1.3521, lng: 103.8198 },
    southindia: { lat: 13.0827, lng: 80.2707 },
    spaincentral: { lat: 40.4168, lng: -3.7038 },
    swedencentral: { lat: 60.6749, lng: 17.1413 },
    switzerlandnorth: { lat: 47.3769, lng: 8.5417 },
    uaenorth: { lat: 25.2048, lng: 55.2708 },
    uksouth: { lat: 51.5072, lng: -0.1276 },
    ukwest: { lat: 53.4084, lng: -2.9916 },
    westcentralus: { lat: 40.7608, lng: -111.891 },
    westeurope: { lat: 52.3676, lng: 4.9041 },
    westindia: { lat: 19.076, lng: 72.8777 },
    westus: { lat: 37.3382, lng: -121.8863 },
    westus2: { lat: 47.6062, lng: -122.3321 },
    westus3: { lat: 33.4484, lng: -112.074 },
  },
};

const CLOUD_LOCATION_PROVIDERS = ['aws', 'gcp', 'azure'] as const;
type CloudLocationProvider = (typeof CLOUD_LOCATION_PROVIDERS)[number];

export const resolveNodeLocationFields = (
  input: NodeLocationInput | null | undefined,
  updatedAt = new Date(),
): NodeLocationFields | null => {
  const provider = normalizeProvider(input?.provider);
  if (!provider) {
    return null;
  }

  const requestedSource = input?.source?.trim();
  const source = normalizeSource(input?.source);
  if (requestedSource && !source) {
    return null;
  }
  const effectiveSource = source ?? defaultSourceForProvider(provider);
  if (!effectiveSource || !isValidProviderSource(provider, effectiveSource)) {
    return null;
  }

  if (isCloudProvider(provider)) {
    const zone = normalizeToken(input?.zone);
    const region =
      normalizeCloudRegion(input?.region) ?? deriveRegion(provider, zone);

    if (!region) {
      return null;
    }

    const coordinates = REGION_COORDINATES[provider][region] ?? null;

    return {
      locationProvider: provider,
      locationSource: effectiveSource,
      locationRegion: region,
      locationZone: zone,
      locationLatitude: coordinates?.lat ?? null,
      locationLongitude: coordinates?.lng ?? null,
      locationUpdatedAt: updatedAt,
    };
  }

  const region = normalizeLocationLabel(input?.region);
  const zone = normalizeLocationLabel(input?.zone);
  const coordinates = normalizeInputCoordinates(
    input?.latitude,
    input?.longitude,
  );
  if (!region || !coordinates) {
    return null;
  }

  return {
    locationProvider: provider,
    locationSource: effectiveSource,
    locationRegion: region,
    locationZone: zone,
    locationLatitude: coordinates.lat,
    locationLongitude: coordinates.lng,
    locationUpdatedAt: updatedAt,
  };
};

export const buildNodeLocationDto = (
  node: Pick<
    NodeEntity,
    | 'locationProvider'
    | 'locationSource'
    | 'locationRegion'
    | 'locationZone'
    | 'locationLatitude'
    | 'locationLongitude'
    | 'locationUpdatedAt'
  >,
): NodeLocationDto | null => {
  if (!node.locationProvider || !node.locationSource || !node.locationRegion) {
    return null;
  }

  return {
    provider: node.locationProvider,
    source: node.locationSource,
    region: node.locationRegion,
    zone: node.locationZone ?? undefined,
    latitude: node.locationLatitude ?? null,
    longitude: node.locationLongitude ?? null,
    updatedAt: node.locationUpdatedAt ?? null,
  };
};

const normalizeProvider = (
  value: string | null | undefined,
): NodeLocationProvider | null => {
  const normalized = normalizeToken(value);
  return NODE_LOCATION_PROVIDERS.includes(normalized as NodeLocationProvider)
    ? (normalized as NodeLocationProvider)
    : null;
};

const normalizeSource = (
  value: string | null | undefined,
): NodeLocationSource | null => {
  const normalized = normalizeToken(value);
  return NODE_LOCATION_SOURCES.includes(normalized as NodeLocationSource)
    ? (normalized as NodeLocationSource)
    : null;
};

const normalizeCloudRegion = (value: string | null | undefined) =>
  normalizeToken(value)?.replace(/\s+/g, '');

const normalizeToken = (value: string | null | undefined) => {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
};

const normalizeLocationLabel = (value: string | null | undefined) => {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 80);
};

const normalizeInputCoordinates = (
  latitude: number | string | null | undefined,
  longitude: number | string | null | undefined,
): RegionCoordinate | null => {
  const lat = normalizeCoordinate(latitude, -90, 90);
  const lng = normalizeCoordinate(longitude, -180, 180);
  if (lat === null || lng === null) {
    return null;
  }
  return { lat, lng };
};

const normalizeCoordinate = (
  value: number | string | null | undefined,
  min: number,
  max: number,
) => {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return null;
  }
  return parsed;
};

const defaultSourceForProvider = (
  provider: NodeLocationProvider,
): NodeLocationSource | null => {
  if (isCloudProvider(provider)) {
    return 'cloud_metadata';
  }
  if (provider === 'manual') {
    return 'manual';
  }
  if (provider === 'public_ip') {
    return 'ipinfo';
  }
  return null;
};

const isValidProviderSource = (
  provider: NodeLocationProvider,
  source: NodeLocationSource,
) => {
  if (isCloudProvider(provider)) {
    return source === 'cloud_metadata';
  }
  if (provider === 'manual') {
    return source === 'manual';
  }
  return provider === 'public_ip' && source === 'ipinfo';
};

const deriveRegion = (
  provider: CloudLocationProvider | null,
  zone: string | null,
) => {
  if (!provider || !zone) {
    return null;
  }

  if (provider === 'gcp') {
    return zone.replace(/-[a-z]$/, '');
  }

  if (provider === 'aws') {
    return zone.replace(/[a-z]$/, '');
  }

  return null;
};

const isCloudProvider = (
  provider: NodeLocationProvider,
): provider is CloudLocationProvider =>
  CLOUD_LOCATION_PROVIDERS.includes(provider as CloudLocationProvider);
