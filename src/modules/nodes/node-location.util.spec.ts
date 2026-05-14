import {
  buildNodeLocationDto,
  resolveNodeLocationFields,
} from './node-location.util';

describe('node location utilities', () => {
  it('resolves known AWS regions to approximate coordinates', () => {
    const updatedAt = new Date('2026-05-12T10:00:00.000Z');

    const fields = resolveNodeLocationFields(
      {
        provider: 'aws',
        source: 'cloud_metadata',
        region: 'US-EAST-1',
        zone: 'us-east-1a',
      },
      updatedAt,
    );

    expect(fields).toEqual({
      locationProvider: 'aws',
      locationSource: 'cloud_metadata',
      locationRegion: 'us-east-1',
      locationZone: 'us-east-1a',
      locationLatitude: 39.0438,
      locationLongitude: -77.4874,
      locationUpdatedAt: updatedAt,
    });
  });

  it('derives GCP region from zone when region is omitted', () => {
    const fields = resolveNodeLocationFields({
      provider: 'gcp',
      source: 'cloud_metadata',
      zone: 'europe-west3-c',
    });

    expect(fields).toEqual(
      expect.objectContaining({
        locationProvider: 'gcp',
        locationRegion: 'europe-west3',
        locationZone: 'europe-west3-c',
        locationLatitude: 50.1109,
        locationLongitude: 8.6821,
      }),
    );
  });

  it('stores unknown cloud regions without coordinates', () => {
    const fields = resolveNodeLocationFields({
      provider: 'azure',
      source: 'cloud_metadata',
      region: 'newregioncentral',
      zone: '1',
    });

    expect(fields).toEqual(
      expect.objectContaining({
        locationProvider: 'azure',
        locationRegion: 'newregioncentral',
        locationZone: '1',
        locationLatitude: null,
        locationLongitude: null,
      }),
    );
  });

  it('ignores unsupported providers', () => {
    expect(
      resolveNodeLocationFields({
        provider: 'digitalocean',
        source: 'cloud_metadata',
        region: 'nyc3',
      }),
    ).toBeNull();
  });

  it('stores manual coordinates when reported by the agent', () => {
    const updatedAt = new Date('2026-05-12T10:00:00.000Z');

    const fields = resolveNodeLocationFields(
      {
        provider: 'manual',
        source: 'manual',
        region: 'Istanbul Home Lab',
        zone: 'Rack 1',
        latitude: 41.0082,
        longitude: 28.9784,
      },
      updatedAt,
    );

    expect(fields).toEqual({
      locationProvider: 'manual',
      locationSource: 'manual',
      locationRegion: 'Istanbul Home Lab',
      locationZone: 'Rack 1',
      locationLatitude: 41.0082,
      locationLongitude: 28.9784,
      locationUpdatedAt: updatedAt,
    });
  });

  it('stores public IP coordinates when reported by IPinfo', () => {
    const fields = resolveNodeLocationFields({
      provider: 'public_ip',
      source: 'ipinfo',
      region: 'Istanbul, TR',
      latitude: '41.0082',
      longitude: '28.9784',
    });

    expect(fields).toEqual(
      expect.objectContaining({
        locationProvider: 'public_ip',
        locationSource: 'ipinfo',
        locationRegion: 'Istanbul, TR',
        locationZone: null,
        locationLatitude: 41.0082,
        locationLongitude: 28.9784,
      }),
    );
  });

  it('ignores manual and public IP locations without valid coordinates', () => {
    expect(
      resolveNodeLocationFields({
        provider: 'manual',
        source: 'manual',
        region: 'Istanbul',
      }),
    ).toBeNull();

    expect(
      resolveNodeLocationFields({
        provider: 'public_ip',
        source: 'ipinfo',
        region: 'Istanbul',
        latitude: 91,
        longitude: 28.9784,
      }),
    ).toBeNull();
  });

  it('ignores provider and source mismatches', () => {
    expect(
      resolveNodeLocationFields({
        provider: 'manual',
        source: 'cloud_metadata',
        region: 'Istanbul',
        latitude: 41.0082,
        longitude: 28.9784,
      }),
    ).toBeNull();
  });

  it('serializes node location DTOs', () => {
    const updatedAt = new Date('2026-05-12T10:00:00.000Z');

    expect(
      buildNodeLocationDto({
        locationProvider: 'aws',
        locationSource: 'cloud_metadata',
        locationRegion: 'eu-central-1',
        locationZone: 'eu-central-1a',
        locationLatitude: 50.1109,
        locationLongitude: 8.6821,
        locationUpdatedAt: updatedAt,
      }),
    ).toEqual({
      provider: 'aws',
      source: 'cloud_metadata',
      region: 'eu-central-1',
      zone: 'eu-central-1a',
      latitude: 50.1109,
      longitude: 8.6821,
      updatedAt,
    });
  });
});
